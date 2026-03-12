use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::VolatilityMiningError;

pub fn record_participation(
    ctx: Context<RecordParticipation>,
    current_regime: u8,
    current_liquidity_e6: u128,
) -> Result<()> {
    require!(current_regime <= 4, VolatilityMiningError::InvalidRegime);

    let config = &mut ctx.accounts.mining_config;
    require!(config.is_active, VolatilityMiningError::MiningNotActive);

    let lp_stake = &mut ctx.accounts.lp_stake;
    require!(lp_stake.is_active, VolatilityMiningError::LpNotActive);

    let clock = Clock::get()?;
    let slots_elapsed = clock.slot.saturating_sub(lp_stake.last_record_slot);

    if slots_elapsed == 0 {
        return Ok(());
    }

    // weight = liquidity * regime_multiplier * slots_elapsed / 100
    let regime_multiplier = config.regime_multipliers[current_regime as usize];
    let weight = (current_liquidity_e6 as u128)
        .checked_mul(regime_multiplier as u128)
        .ok_or(VolatilityMiningError::MathOverflow)?
        .checked_mul(slots_elapsed as u128)
        .ok_or(VolatilityMiningError::MathOverflow)?
        / 100;

    lp_stake.current_epoch_weight = lp_stake.current_epoch_weight
        .checked_add(weight)
        .ok_or(VolatilityMiningError::MathOverflow)?;
    lp_stake.liquidity_amount_e6 = current_liquidity_e6;
    lp_stake.last_record_slot = clock.slot;

    config.total_reward_weight = config.total_reward_weight
        .checked_add(weight)
        .ok_or(VolatilityMiningError::MathOverflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct RecordParticipation<'info> {
    #[account(
        constraint = authority.key() == mining_config.authority @ VolatilityMiningError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub mining_config: Account<'info, MiningConfig>,

    #[account(
        mut,
        constraint = lp_stake.is_active @ VolatilityMiningError::LpNotActive
    )]
    pub lp_stake: Account<'info, LpStake>,
}
