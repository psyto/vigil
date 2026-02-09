use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::NcnOracleError;

pub fn initialize_ncn_yield_feed(
    ctx: Context<InitializeNcnYieldFeed>,
    initial_apy_bps: u64,
) -> Result<()> {
    let feed = &mut ctx.accounts.ncn_yield_feed;
    let clock = Clock::get()?;

    feed.authority = ctx.accounts.authority.key();
    feed.ncn_address = ctx.accounts.ncn_address.key();
    feed.current_apy_bps = initial_apy_bps;
    feed.apy_7d_avg = initial_apy_bps;
    feed.apy_30d_avg = initial_apy_bps;
    feed.yield_variance_bps = 0;
    feed.yield_regime = 2; // Normal
    feed.yield_history = Vec::new();
    feed.base_staking_apy_bps = 0;
    feed.mev_apy_bps = 0;
    feed.restaking_premium_bps = 0;
    feed.is_active = true;
    feed.last_updated = clock.unix_timestamp;
    feed.bump = ctx.bumps.ncn_yield_feed;

    Ok(())
}

pub fn record_ncn_yield(
    ctx: Context<RecordNcnYield>,
    current_apy_bps: u64,
    base_staking_apy_bps: u64,
    mev_apy_bps: u64,
    restaking_premium_bps: u64,
) -> Result<()> {
    let feed = &mut ctx.accounts.ncn_yield_feed;
    let clock = Clock::get()?;

    feed.current_apy_bps = current_apy_bps;
    feed.base_staking_apy_bps = base_staking_apy_bps;
    feed.mev_apy_bps = mev_apy_bps;
    feed.restaking_premium_bps = restaking_premium_bps;

    // Add to yield history
    let current_variance = feed.yield_variance_bps;
    feed.yield_history.push(YieldSample {
        apy_bps: current_apy_bps,
        variance_bps: current_variance,
        timestamp: clock.unix_timestamp,
    });

    if feed.yield_history.len() > 168 {
        feed.yield_history.remove(0);
    }

    // Recalculate averages
    let samples_7d: Vec<u64> = feed.yield_history
        .iter()
        .filter(|s| clock.unix_timestamp - s.timestamp <= 7 * 86400)
        .map(|s| s.apy_bps)
        .collect();

    if !samples_7d.is_empty() {
        feed.apy_7d_avg = samples_7d.iter().sum::<u64>() / samples_7d.len() as u64;
    }

    let samples_30d: Vec<u64> = feed.yield_history
        .iter()
        .filter(|s| clock.unix_timestamp - s.timestamp <= 30 * 86400)
        .map(|s| s.apy_bps)
        .collect();

    if !samples_30d.is_empty() {
        feed.apy_30d_avg = samples_30d.iter().sum::<u64>() / samples_30d.len() as u64;
    }

    // Recalculate variance and regime
    feed.yield_variance_bps = feed.calculate_variance();
    feed.yield_regime = NcnYieldFeed::classify_regime(feed.yield_variance_bps);

    feed.last_updated = clock.unix_timestamp;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeNcnYieldFeed<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: NCN address (Fragmetric/Jito NCN identifier)
    pub ncn_address: AccountInfo<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + NcnYieldFeed::INIT_SPACE,
        seeds = [b"ncn_yield_feed", ncn_address.key().as_ref()],
        bump
    )]
    pub ncn_yield_feed: Account<'info, NcnYieldFeed>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordNcnYield<'info> {
    #[account(
        constraint = authority.key() == ncn_yield_feed.authority @ NcnOracleError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = ncn_yield_feed.is_active @ NcnOracleError::FeedInactive
    )]
    pub ncn_yield_feed: Account<'info, NcnYieldFeed>,
}
