use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::errors::NcnOracleError;

// =============================================================================
// Initialize Reporter Registry
// =============================================================================

pub fn initialize_reporter_registry(
    ctx: Context<InitializeReporterRegistry>,
    min_reporters: u8,
    stake_requirement: u64,
    slash_threshold_bps: u64,
) -> Result<()> {
    let registry = &mut ctx.accounts.reporter_registry;

    registry.authority = ctx.accounts.authority.key();
    registry.ncn_address = ctx.accounts.ncn_address.key();
    registry.min_reporters = min_reporters;
    registry.stake_requirement = stake_requirement;
    registry.slash_threshold_bps = slash_threshold_bps;
    registry.reporters = Vec::new();
    registry.is_active = true;
    registry.bump = ctx.bumps.reporter_registry;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeReporterRegistry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: NCN address identifier
    pub ncn_address: AccountInfo<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + ReporterRegistry::INIT_SPACE,
        seeds = [b"reporter_registry", ncn_address.key().as_ref()],
        bump
    )]
    pub reporter_registry: Account<'info, ReporterRegistry>,

    pub system_program: Program<'info, System>,
}

// =============================================================================
// Register Reporter
// =============================================================================

pub fn register_reporter(
    ctx: Context<RegisterReporter>,
) -> Result<()> {
    let registry = &mut ctx.accounts.reporter_registry;

    require!(registry.reporters.len() < 16, NcnOracleError::MaxReportersReached);
    require!(
        registry.find_reporter(&ctx.accounts.reporter.key()).is_none(),
        NcnOracleError::ReporterAlreadyRegistered
    );

    // Transfer stake from reporter to stake PDA
    let stake_amount = registry.stake_requirement;
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.reporter.to_account_info(),
                to: ctx.accounts.reporter_stake.to_account_info(),
            },
        ),
        stake_amount,
    )?;

    let clock = Clock::get()?;
    registry.reporters.push(ReporterInfo {
        pubkey: ctx.accounts.reporter.key(),
        stake_account: ctx.accounts.reporter_stake.key(),
        total_reports: 0,
        slashing_count: 0,
        last_report_time: clock.unix_timestamp,
        is_active: true,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct RegisterReporter<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,

    #[account(
        constraint = authority.key() == reporter_registry.authority @ NcnOracleError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub reporter_registry: Account<'info, ReporterRegistry>,

    /// CHECK: PDA to hold reporter's staked SOL
    #[account(
        mut,
        seeds = [b"reporter_stake", reporter_registry.key().as_ref(), reporter.key().as_ref()],
        bump
    )]
    pub reporter_stake: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

// =============================================================================
// Submit Report
// =============================================================================

pub fn submit_report(
    ctx: Context<SubmitReport>,
    round: u64,
    uptime_e6: u64,
    total_restaked_sol: u64,
    restaker_count: u32,
    current_apy_bps: u64,
) -> Result<()> {
    require!(uptime_e6 <= 1_000_000, NcnOracleError::InvalidUptimeProbability);

    let registry = &ctx.accounts.reporter_registry;
    require!(
        registry.find_reporter(&ctx.accounts.reporter.key()).is_some(),
        NcnOracleError::ReporterNotFound
    );

    let pending = &mut ctx.accounts.pending_submission;

    // Initialize if first submission for this round
    if pending.round == 0 && pending.submissions.is_empty() {
        pending.ncn_address = registry.ncn_address;
        pending.round = round;
        pending.is_finalized = false;
        pending.finalized_uptime_e6 = 0;
        pending.finalized_restaked_sol = 0;
        pending.finalized_restaker_count = 0;
        pending.finalized_apy_bps = 0;
        pending.finalized_time = 0;
        pending.bump = ctx.bumps.pending_submission;
    }

    require!(!pending.is_finalized, NcnOracleError::AlreadyFinalized);
    require!(
        !pending.has_reporter_submitted(&ctx.accounts.reporter.key()),
        NcnOracleError::SubmissionAlreadyExists
    );

    let clock = Clock::get()?;
    pending.submissions.push(ReporterSubmission {
        reporter: ctx.accounts.reporter.key(),
        uptime_e6,
        total_restaked_sol,
        restaker_count,
        current_apy_bps,
        timestamp: clock.unix_timestamp,
    });

    // Update reporter stats
    let registry = &mut ctx.accounts.reporter_registry;
    if let Some(idx) = registry.find_reporter(&ctx.accounts.reporter.key()) {
        registry.reporters[idx].total_reports += 1;
        registry.reporters[idx].last_report_time = clock.unix_timestamp;
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(round: u64)]
pub struct SubmitReport<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,

    #[account(mut)]
    pub reporter_registry: Account<'info, ReporterRegistry>,

    #[account(
        init_if_needed,
        payer = reporter,
        space = 8 + PendingSubmission::INIT_SPACE,
        seeds = [b"pending_submission", reporter_registry.ncn_address.as_ref(), round.to_le_bytes().as_ref()],
        bump
    )]
    pub pending_submission: Account<'info, PendingSubmission>,

    pub system_program: Program<'info, System>,
}

// =============================================================================
// Finalize Report
// =============================================================================

pub fn finalize_report(
    ctx: Context<FinalizeReport>,
) -> Result<()> {
    let registry = &ctx.accounts.reporter_registry;
    let pending = &mut ctx.accounts.pending_submission;

    require!(!pending.is_finalized, NcnOracleError::AlreadyFinalized);
    require!(
        pending.submissions.len() >= registry.min_reporters as usize,
        NcnOracleError::MinReportersNotMet
    );

    // Compute medians
    let mut uptimes: Vec<u64> = pending.submissions.iter().map(|s| s.uptime_e6).collect();
    let mut restaked: Vec<u64> = pending.submissions.iter().map(|s| s.total_restaked_sol).collect();
    let mut restakers: Vec<u32> = pending.submissions.iter().map(|s| s.restaker_count).collect();
    let mut apys: Vec<u64> = pending.submissions.iter().map(|s| s.current_apy_bps).collect();

    let median_uptime = PendingSubmission::median_u64(&mut uptimes);
    let median_restaked = PendingSubmission::median_u64(&mut restaked);
    let median_restakers = PendingSubmission::median_u32(&mut restakers);
    let median_apy = PendingSubmission::median_u64(&mut apys);

    let clock = Clock::get()?;

    pending.finalized_uptime_e6 = median_uptime;
    pending.finalized_restaked_sol = median_restaked;
    pending.finalized_restaker_count = median_restakers;
    pending.finalized_apy_bps = median_apy;
    pending.finalized_time = clock.unix_timestamp;
    pending.is_finalized = true;

    // Update performance feed
    let perf_feed = &mut ctx.accounts.ncn_performance_feed;
    require!(perf_feed.governance_mode == 1, NcnOracleError::InvalidGovernanceMode);

    perf_feed.uptime_probability_e6 = median_uptime;
    perf_feed.total_restaked_sol = median_restaked;
    perf_feed.restaker_count = median_restakers;
    perf_feed.last_updated = clock.unix_timestamp;

    perf_feed.performance_history.push(NcnPerformanceSample {
        uptime_e6: median_uptime,
        total_restaked_sol: median_restaked,
        restaker_count: median_restakers,
        timestamp: clock.unix_timestamp,
    });
    if perf_feed.performance_history.len() > 168 {
        perf_feed.performance_history.remove(0);
    }

    // Update yield feed
    let yield_feed = &mut ctx.accounts.ncn_yield_feed;
    require!(yield_feed.governance_mode == 1, NcnOracleError::InvalidGovernanceMode);

    yield_feed.current_apy_bps = median_apy;
    yield_feed.last_updated = clock.unix_timestamp;

    let variance = yield_feed.calculate_variance();
    yield_feed.yield_variance_bps = variance;
    yield_feed.yield_regime = NcnYieldFeed::classify_regime(variance);

    yield_feed.yield_history.push(YieldSample {
        apy_bps: median_apy,
        variance_bps: variance,
        timestamp: clock.unix_timestamp,
    });
    if yield_feed.yield_history.len() > 168 {
        yield_feed.yield_history.remove(0);
    }

    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeReport<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub reporter_registry: Account<'info, ReporterRegistry>,

    #[account(
        mut,
        constraint = pending_submission.ncn_address == reporter_registry.ncn_address @ NcnOracleError::NcnFeedNotFound
    )]
    pub pending_submission: Account<'info, PendingSubmission>,

    #[account(
        mut,
        constraint = ncn_performance_feed.ncn_address == reporter_registry.ncn_address @ NcnOracleError::NcnFeedNotFound
    )]
    pub ncn_performance_feed: Account<'info, NcnPerformanceFeed>,

    #[account(
        mut,
        constraint = ncn_yield_feed.ncn_address == reporter_registry.ncn_address @ NcnOracleError::NcnFeedNotFound
    )]
    pub ncn_yield_feed: Account<'info, NcnYieldFeed>,
}

// =============================================================================
// Slash Reporter
// =============================================================================

pub fn slash_reporter(
    ctx: Context<SlashReporter>,
    reporter_pubkey: Pubkey,
) -> Result<()> {
    let registry = &mut ctx.accounts.reporter_registry;
    let pending = &ctx.accounts.pending_submission;

    require!(pending.is_finalized, NcnOracleError::MinReportersNotMet);

    // Find reporter's submission
    let submission = pending.submissions.iter()
        .find(|s| s.reporter == reporter_pubkey)
        .ok_or(NcnOracleError::ReporterNotFound)?;

    // Check deviation from consensus
    let uptime_deviation = if submission.uptime_e6 > pending.finalized_uptime_e6 {
        submission.uptime_e6 - pending.finalized_uptime_e6
    } else {
        pending.finalized_uptime_e6 - submission.uptime_e6
    };

    // Deviation as bps of the median
    let deviation_bps = if pending.finalized_uptime_e6 > 0 {
        uptime_deviation * 10_000 / pending.finalized_uptime_e6
    } else {
        0
    };

    require!(deviation_bps > registry.slash_threshold_bps, NcnOracleError::DeviationTooHigh);

    // Slash 10% of stake
    let slash_amount = registry.stake_requirement / 10;
    let stake_info = ctx.accounts.reporter_stake.to_account_info();
    let authority_info = ctx.accounts.authority.to_account_info();

    **stake_info.try_borrow_mut_lamports()? -= slash_amount;
    **authority_info.try_borrow_mut_lamports()? += slash_amount;

    // Update reporter stats
    if let Some(idx) = registry.reporters.iter().position(|r| r.pubkey == reporter_pubkey) {
        registry.reporters[idx].slashing_count += 1;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct SlashReporter<'info> {
    #[account(
        mut,
        constraint = authority.key() == reporter_registry.authority @ NcnOracleError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub reporter_registry: Account<'info, ReporterRegistry>,

    pub pending_submission: Account<'info, PendingSubmission>,

    /// CHECK: Reporter stake PDA — lamports are transferred out
    #[account(mut)]
    pub reporter_stake: AccountInfo<'info>,
}

// =============================================================================
// Deregister Reporter
// =============================================================================

pub fn deregister_reporter(
    ctx: Context<DeregisterReporter>,
) -> Result<()> {
    let registry = &mut ctx.accounts.reporter_registry;
    let reporter_key = ctx.accounts.reporter.key();

    let idx = registry.find_reporter(&reporter_key)
        .ok_or(NcnOracleError::ReporterNotFound)?;

    // Return remaining stake to reporter
    let stake_info = ctx.accounts.reporter_stake.to_account_info();
    let reporter_info = ctx.accounts.reporter.to_account_info();
    let remaining = stake_info.lamports();

    **stake_info.try_borrow_mut_lamports()? -= remaining;
    **reporter_info.try_borrow_mut_lamports()? += remaining;

    // Deactivate reporter
    registry.reporters[idx].is_active = false;

    Ok(())
}

#[derive(Accounts)]
pub struct DeregisterReporter<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,

    #[account(mut)]
    pub reporter_registry: Account<'info, ReporterRegistry>,

    /// CHECK: Reporter stake PDA — lamports returned to reporter
    #[account(mut)]
    pub reporter_stake: AccountInfo<'info>,
}

// =============================================================================
// Upgrade to Multi-Reporter
// =============================================================================

pub fn upgrade_to_multi_reporter(
    ctx: Context<UpgradeToMultiReporter>,
) -> Result<()> {
    let perf_feed = &mut ctx.accounts.ncn_performance_feed;
    let yield_feed = &mut ctx.accounts.ncn_yield_feed;

    require!(perf_feed.governance_mode == 0, NcnOracleError::InvalidGovernanceMode);
    require!(yield_feed.governance_mode == 0, NcnOracleError::InvalidGovernanceMode);

    perf_feed.governance_mode = 1;
    yield_feed.governance_mode = 1;

    Ok(())
}

#[derive(Accounts)]
pub struct UpgradeToMultiReporter<'info> {
    #[account(
        constraint = authority.key() == ncn_performance_feed.authority @ NcnOracleError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub ncn_performance_feed: Account<'info, NcnPerformanceFeed>,

    #[account(
        mut,
        constraint = ncn_yield_feed.ncn_address == ncn_performance_feed.ncn_address @ NcnOracleError::NcnFeedNotFound
    )]
    pub ncn_yield_feed: Account<'info, NcnYieldFeed>,
}
