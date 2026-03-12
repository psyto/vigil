use anchor_lang::prelude::*;

/// Global mining configuration (singleton PDA)
#[account]
#[derive(InitSpace)]
pub struct MiningConfig {
    /// Authority that manages mining config
    pub authority: Pubkey,

    /// SPL token mint for rewards
    pub reward_mint: Pubkey,

    /// Token account holding reward pool
    pub reward_vault: Pubkey,

    /// Base reward tokens per slot (in smallest units)
    pub emission_rate_per_slot: u64,

    /// Regime multipliers (indexed by regime 0-4)
    /// VeryLow=50, Low=75, Normal=100, High=200, Extreme=400
    pub regime_multipliers: [u64; 5],

    /// Minimum participation duration in slots to earn rewards
    pub min_duration_slots: u64,

    /// Reward epoch length in slots
    pub epoch_duration_slots: u64,

    /// Current mining epoch number
    pub current_epoch: u64,

    /// Slot when current epoch started
    pub epoch_start_slot: u64,

    /// Sum of all LP weights in current epoch
    pub total_reward_weight: u128,

    /// Total registered LPs
    pub registered_lp_count: u32,

    /// Whether mining is active
    pub is_active: bool,

    /// PDA bump seed
    pub bump: u8,
}

/// Per-LP stake tracking
#[account]
#[derive(InitSpace)]
pub struct LpStake {
    /// The LP PDA from matcher context
    pub lp_pda: Pubkey,

    /// LP owner who can claim rewards
    pub owner: Pubkey,

    /// Which matcher context this LP is in
    pub matcher_context: Pubkey,

    /// Matcher type: 0=yield, 1=uptime, 2=index
    pub matcher_type: u8,

    /// Current liquidity amount (updated by keeper)
    pub liquidity_amount_e6: u128,

    /// Slot when LP registered
    pub entry_slot: u64,

    /// Last slot participation was recorded
    pub last_record_slot: u64,

    /// Last epoch rewards were claimed
    pub last_claim_epoch: u64,

    /// Accumulated regime-weighted participation in current epoch
    pub current_epoch_weight: u128,

    /// Total lifetime claimed rewards
    pub total_claimed: u64,

    /// Whether LP is actively participating
    pub is_active: bool,

    /// PDA bump seed
    pub bump: u8,
}

/// Snapshot of a completed epoch
#[account]
#[derive(InitSpace)]
pub struct EpochSnapshot {
    /// Epoch number
    pub epoch: u64,

    /// Total reward weight for this epoch
    pub total_reward_weight: u128,

    /// Total rewards available for this epoch (emission_rate * epoch_duration)
    pub total_rewards: u64,

    /// Total rewards claimed from this epoch
    pub total_claimed: u64,

    /// Average regime during this epoch
    pub avg_regime: u8,

    /// Slot when epoch started
    pub slot_start: u64,

    /// Slot when epoch ended
    pub slot_end: u64,

    /// Whether epoch is finalized
    pub is_finalized: bool,

    /// PDA bump seed
    pub bump: u8,
}
