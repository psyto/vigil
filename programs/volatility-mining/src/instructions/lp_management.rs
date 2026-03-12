use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::VolatilityMiningError;

pub fn register_lp(
    ctx: Context<RegisterLp>,
    matcher_type: u8,
) -> Result<()> {
    require!(matcher_type <= 2, VolatilityMiningError::InvalidMatcherType);

    let config = &mut ctx.accounts.mining_config;
    require!(config.is_active, VolatilityMiningError::MiningNotActive);

    let lp_stake = &mut ctx.accounts.lp_stake;
    let clock = Clock::get()?;

    lp_stake.lp_pda = ctx.accounts.lp_pda.key();
    lp_stake.owner = ctx.accounts.owner.key();
    lp_stake.matcher_context = ctx.accounts.matcher_context.key();
    lp_stake.matcher_type = matcher_type;
    lp_stake.liquidity_amount_e6 = 0;
    lp_stake.entry_slot = clock.slot;
    lp_stake.last_record_slot = clock.slot;
    lp_stake.last_claim_epoch = 0;
    lp_stake.current_epoch_weight = 0;
    lp_stake.total_claimed = 0;
    lp_stake.is_active = true;
    lp_stake.bump = ctx.bumps.lp_stake;

    config.registered_lp_count = config.registered_lp_count
        .checked_add(1)
        .ok_or(VolatilityMiningError::MathOverflow)?;

    Ok(())
}

pub fn deregister_lp(
    ctx: Context<DeregisterLp>,
) -> Result<()> {
    let lp_stake = &mut ctx.accounts.lp_stake;
    require!(lp_stake.is_active, VolatilityMiningError::LpNotActive);

    // Ensure no pending unclaimed rewards
    let config = &mut ctx.accounts.mining_config;
    require!(
        lp_stake.current_epoch_weight == 0 || lp_stake.last_claim_epoch >= config.current_epoch.saturating_sub(1),
        VolatilityMiningError::PendingRewards
    );

    lp_stake.is_active = false;

    config.registered_lp_count = config.registered_lp_count.saturating_sub(1);

    Ok(())
}

#[derive(Accounts)]
pub struct RegisterLp<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: LP PDA from matcher context
    pub lp_pda: AccountInfo<'info>,

    /// CHECK: The matcher context account
    pub matcher_context: AccountInfo<'info>,

    #[account(
        mut,
        constraint = mining_config.is_active @ VolatilityMiningError::MiningNotActive
    )]
    pub mining_config: Account<'info, MiningConfig>,

    #[account(
        init,
        payer = owner,
        space = 8 + LpStake::INIT_SPACE,
        seeds = [b"lp_stake", lp_pda.key().as_ref()],
        bump
    )]
    pub lp_stake: Account<'info, LpStake>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DeregisterLp<'info> {
    #[account(
        constraint = owner.key() == lp_stake.owner @ VolatilityMiningError::Unauthorized
    )]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub mining_config: Account<'info, MiningConfig>,

    #[account(
        mut,
        constraint = lp_stake.is_active @ VolatilityMiningError::LpNotActive
    )]
    pub lp_stake: Account<'info, LpStake>,
}
