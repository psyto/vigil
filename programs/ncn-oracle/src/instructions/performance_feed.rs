use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::NcnOracleError;

pub fn initialize_ncn_performance_feed(
    ctx: Context<InitializeNcnPerformanceFeed>,
    ncn_name: String,
    initial_uptime_e6: u64,
) -> Result<()> {
    require!(ncn_name.len() <= 32, NcnOracleError::NameTooLong);
    require!(initial_uptime_e6 <= 1_000_000, NcnOracleError::InvalidUptimeProbability);

    let feed = &mut ctx.accounts.ncn_performance_feed;
    let clock = Clock::get()?;

    feed.authority = ctx.accounts.authority.key();
    feed.ncn_address = ctx.accounts.ncn_address.key();
    feed.ncn_name = ncn_name;
    feed.uptime_probability_e6 = initial_uptime_e6;
    feed.total_slashing_events = 0;
    feed.last_slashing_time = 0;
    feed.total_restaked_sol = 0;
    feed.restaker_count = 0;
    feed.performance_history = Vec::new();
    feed.signal_severity = 0;
    feed.sovereign_infra_score = 0;
    feed.is_active = true;
    feed.last_updated = clock.unix_timestamp;
    feed.bump = ctx.bumps.ncn_performance_feed;

    Ok(())
}

pub fn record_ncn_performance(
    ctx: Context<RecordNcnPerformance>,
    uptime_e6: u64,
    total_restaked_sol: u64,
    restaker_count: u32,
    slashing_event: bool,
) -> Result<()> {
    require!(uptime_e6 <= 1_000_000, NcnOracleError::InvalidUptimeProbability);

    let feed = &mut ctx.accounts.ncn_performance_feed;
    let clock = Clock::get()?;

    feed.uptime_probability_e6 = uptime_e6;
    feed.total_restaked_sol = total_restaked_sol;
    feed.restaker_count = restaker_count;

    if slashing_event {
        feed.total_slashing_events += 1;
        feed.last_slashing_time = clock.unix_timestamp;
    }

    // Add to performance history (circular buffer, max 168)
    feed.performance_history.push(NcnPerformanceSample {
        uptime_e6,
        total_restaked_sol,
        restaker_count,
        timestamp: clock.unix_timestamp,
    });

    if feed.performance_history.len() > 168 {
        feed.performance_history.remove(0);
    }

    feed.last_updated = clock.unix_timestamp;

    Ok(())
}

// Account contexts
#[derive(Accounts)]
#[instruction(ncn_name: String)]
pub struct InitializeNcnPerformanceFeed<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: NCN address (Fragmetric/Jito NCN identifier)
    pub ncn_address: AccountInfo<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + NcnPerformanceFeed::INIT_SPACE,
        seeds = [b"ncn_perf_feed", ncn_address.key().as_ref()],
        bump
    )]
    pub ncn_performance_feed: Account<'info, NcnPerformanceFeed>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordNcnPerformance<'info> {
    #[account(
        constraint = authority.key() == ncn_performance_feed.authority @ NcnOracleError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = ncn_performance_feed.is_active @ NcnOracleError::FeedInactive
    )]
    pub ncn_performance_feed: Account<'info, NcnPerformanceFeed>,
}
