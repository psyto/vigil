use shank::ShankInstruction;

#[derive(ShankInstruction)]
pub enum YieldMatcherInstruction {
    /// Execute match — compute yield-regime-adjusted execution price
    #[account(0, signer, name = "lp_pda", desc = "LP PDA (must be signer)")]
    #[account(1, writable, name = "matcher_context", desc = "Matcher context account (320 bytes)")]
    Match,

    /// Initialize restaking yield matcher context
    #[account(0, name = "lp_pda", desc = "LP PDA to store")]
    #[account(1, writable, name = "matcher_context", desc = "Matcher context account (320 bytes, writable)")]
    Init,

    /// Sync oracle — keeper updates yield data from NCN oracle
    #[account(0, writable, name = "matcher_context", desc = "Matcher context account")]
    #[account(1, name = "ncn_yield_feed", desc = "NcnYieldFeed account")]
    #[account(2, name = "ncn_performance_feed", desc = "NcnPerformanceFeed account")]
    OracleSync,
}
