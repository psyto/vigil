use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::NcnOracleError;

pub fn initialize_aggregated_feed(
    ctx: Context<InitializeAggregatedRestakingFeed>,
) -> Result<()> {
    let feed = &mut ctx.accounts.aggregated_feed;
    let clock = Clock::get()?;

    feed.authority = ctx.accounts.authority.key();
    feed.total_restaked_sol = 0;
    feed.weighted_avg_apy_bps = 0;
    feed.ncn_count = 0;
    feed.ncn_feeds = Vec::new();
    feed.is_active = true;
    feed.last_updated = clock.unix_timestamp;
    feed.bump = ctx.bumps.aggregated_feed;

    Ok(())
}

pub fn add_ncn_feed(
    ctx: Context<AddNcnFeed>,
) -> Result<()> {
    let feed = &mut ctx.accounts.aggregated_feed;

    require!(feed.ncn_feeds.len() < 32, NcnOracleError::MaxNcnFeedsReached);

    feed.ncn_feeds.push(ctx.accounts.ncn_performance_feed.key());
    feed.ncn_count = feed.ncn_feeds.len() as u32;

    Ok(())
}

pub fn update_aggregated_feed(
    ctx: Context<UpdateAggregatedFeed>,
    total_restaked_sol: u64,
    weighted_avg_apy_bps: u64,
) -> Result<()> {
    let feed = &mut ctx.accounts.aggregated_feed;
    let clock = Clock::get()?;

    feed.total_restaked_sol = total_restaked_sol;
    feed.weighted_avg_apy_bps = weighted_avg_apy_bps;
    feed.last_updated = clock.unix_timestamp;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeAggregatedRestakingFeed<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + AggregatedRestakingFeed::INIT_SPACE,
        seeds = [b"aggregated_restaking_feed"],
        bump
    )]
    pub aggregated_feed: Account<'info, AggregatedRestakingFeed>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddNcnFeed<'info> {
    #[account(
        constraint = authority.key() == aggregated_feed.authority @ NcnOracleError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub aggregated_feed: Account<'info, AggregatedRestakingFeed>,

    pub ncn_performance_feed: Account<'info, NcnPerformanceFeed>,
}

#[derive(Accounts)]
pub struct UpdateAggregatedFeed<'info> {
    #[account(
        constraint = authority.key() == aggregated_feed.authority @ NcnOracleError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = aggregated_feed.is_active @ NcnOracleError::FeedInactive
    )]
    pub aggregated_feed: Account<'info, AggregatedRestakingFeed>,
}
