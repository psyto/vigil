use anchor_lang::prelude::*;

declare_id!("VMine11111111111111111111111111111111111111");

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

#[program]
pub mod volatility_mining {
    use super::*;

    pub fn initialize_mining(
        ctx: Context<InitializeMining>,
        emission_rate_per_slot: u64,
        regime_multipliers: [u64; 5],
        min_duration_slots: u64,
        epoch_duration_slots: u64,
    ) -> Result<()> {
        instructions::initialize::initialize_mining(ctx, emission_rate_per_slot, regime_multipliers, min_duration_slots, epoch_duration_slots)
    }

    pub fn register_lp(
        ctx: Context<RegisterLp>,
        matcher_type: u8,
    ) -> Result<()> {
        instructions::lp_management::register_lp(ctx, matcher_type)
    }

    pub fn record_participation(
        ctx: Context<RecordParticipation>,
        current_regime: u8,
        current_liquidity_e6: u128,
    ) -> Result<()> {
        instructions::participation::record_participation(ctx, current_regime, current_liquidity_e6)
    }

    pub fn finalize_epoch(ctx: Context<FinalizeEpoch>) -> Result<()> {
        instructions::epoch::finalize_epoch(ctx)
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::rewards::claim_rewards(ctx)
    }

    pub fn deregister_lp(ctx: Context<DeregisterLp>) -> Result<()> {
        instructions::lp_management::deregister_lp(ctx)
    }

    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        instructions::rewards::fund_rewards(ctx, amount)
    }
}
