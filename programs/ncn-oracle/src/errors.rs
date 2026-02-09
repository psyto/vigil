use anchor_lang::prelude::*;

#[error_code]
pub enum NcnOracleError {
    #[msg("Unauthorized: caller is not the authority")]
    Unauthorized,

    #[msg("Feed is inactive")]
    FeedInactive,

    #[msg("NCN name too long (max 32 characters)")]
    NameTooLong,

    #[msg("Invalid uptime probability (must be 0-1_000_000)")]
    InvalidUptimeProbability,

    #[msg("Invalid APY (must be > 0)")]
    InvalidApy,

    #[msg("Invalid signal severity (must be 0-3)")]
    InvalidSignalSeverity,

    #[msg("Maximum NCN feeds reached")]
    MaxNcnFeedsReached,

    #[msg("NCN feed not found in aggregated feed")]
    NcnFeedNotFound,

    #[msg("Performance history full")]
    PerformanceHistoryFull,

    #[msg("Yield history full")]
    YieldHistoryFull,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Invalid yield regime (must be 0-4)")]
    InvalidYieldRegime,
}
