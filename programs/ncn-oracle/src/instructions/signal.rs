use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::NcnOracleError;

pub fn update_signal_severity(
    ctx: Context<UpdateSignalSeverity>,
    severity: u8,
) -> Result<()> {
    require!(severity <= 3, NcnOracleError::InvalidSignalSeverity);

    let feed = &mut ctx.accounts.ncn_performance_feed;
    let clock = Clock::get()?;

    feed.signal_severity = severity;
    feed.last_updated = clock.unix_timestamp;

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateSignalSeverity<'info> {
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
