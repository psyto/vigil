use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::VolatilityMiningError;

pub fn finalize_epoch(
    ctx: Context<FinalizeEpoch>,
) -> Result<()> {
    let config = &mut ctx.accounts.mining_config;
    let clock = Clock::get()?;

    // Verify epoch duration has elapsed
    let epoch_end_slot = config.epoch_start_slot
        .checked_add(config.epoch_duration_slots)
        .ok_or(VolatilityMiningError::MathOverflow)?;
    require!(clock.slot >= epoch_end_slot, VolatilityMiningError::EpochNotComplete);

    // Create epoch snapshot
    let snapshot = &mut ctx.accounts.epoch_snapshot;
    snapshot.epoch = config.current_epoch;
    snapshot.total_reward_weight = config.total_reward_weight;
    snapshot.total_rewards = config.emission_rate_per_slot
        .checked_mul(config.epoch_duration_slots)
        .ok_or(VolatilityMiningError::MathOverflow)?;
    snapshot.total_claimed = 0;
    snapshot.avg_regime = 2; // Default to Normal
    snapshot.slot_start = config.epoch_start_slot;
    snapshot.slot_end = clock.slot;
    snapshot.is_finalized = true;
    snapshot.bump = ctx.bumps.epoch_snapshot;

    // Reset config for next epoch
    config.total_reward_weight = 0;
    config.current_epoch = config.current_epoch
        .checked_add(1)
        .ok_or(VolatilityMiningError::MathOverflow)?;
    config.epoch_start_slot = clock.slot;

    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeEpoch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = mining_config.is_active @ VolatilityMiningError::MiningNotActive
    )]
    pub mining_config: Account<'info, MiningConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + EpochSnapshot::INIT_SPACE,
        seeds = [b"epoch_snapshot", mining_config.current_epoch.to_le_bytes().as_ref()],
        bump
    )]
    pub epoch_snapshot: Account<'info, EpochSnapshot>,

    pub system_program: Program<'info, System>,
}
