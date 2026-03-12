use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::state::*;

pub fn initialize_mining(
    ctx: Context<InitializeMining>,
    emission_rate_per_slot: u64,
    regime_multipliers: [u64; 5],
    min_duration_slots: u64,
    epoch_duration_slots: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.mining_config;
    let clock = Clock::get()?;

    config.authority = ctx.accounts.authority.key();
    config.reward_mint = ctx.accounts.reward_mint.key();
    config.reward_vault = ctx.accounts.reward_vault.key();
    config.emission_rate_per_slot = emission_rate_per_slot;
    config.regime_multipliers = regime_multipliers;
    config.min_duration_slots = min_duration_slots;
    config.epoch_duration_slots = epoch_duration_slots;
    config.current_epoch = 0;
    config.epoch_start_slot = clock.slot;
    config.total_reward_weight = 0;
    config.registered_lp_count = 0;
    config.is_active = true;
    config.bump = ctx.bumps.mining_config;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeMining<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub reward_mint: Account<'info, Mint>,

    #[account(
        constraint = reward_vault.mint == reward_mint.key(),
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        space = 8 + MiningConfig::INIT_SPACE,
        seeds = [b"mining_config"],
        bump
    )]
    pub mining_config: Account<'info, MiningConfig>,

    pub system_program: Program<'info, System>,
}
