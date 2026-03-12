use anchor_lang::prelude::*;

#[error_code]
pub enum VolatilityMiningError {
    #[msg("Mining is not active")]
    MiningNotActive,

    #[msg("LP is not active")]
    LpNotActive,

    #[msg("LP already registered")]
    LpAlreadyRegistered,

    #[msg("Invalid matcher type (must be 0-2)")]
    InvalidMatcherType,

    #[msg("Invalid regime (must be 0-4)")]
    InvalidRegime,

    #[msg("Epoch not yet complete")]
    EpochNotComplete,

    #[msg("Epoch already finalized")]
    EpochAlreadyFinalized,

    #[msg("No rewards to claim")]
    NoRewardsToClaim,

    #[msg("Insufficient reward balance")]
    InsufficientRewardBalance,

    #[msg("Min duration not met")]
    MinDurationNotMet,

    #[msg("Must claim pending rewards before deregistering")]
    PendingRewards,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Unauthorized")]
    Unauthorized,
}
