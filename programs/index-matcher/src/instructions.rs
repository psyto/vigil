use shank::ShankInstruction;

#[derive(ShankInstruction)]
pub enum IndexMatcherInstruction {
    /// Execute match — compute index-regime-adjusted execution price
    #[account(0, signer, name = "lp_pda", desc = "LP PDA (signer)")]
    #[account(1, writable, name = "matcher_context", desc = "Matcher context account (320 bytes)")]
    Match,

    /// Initialize index matcher context
    #[account(0, signer, name = "lp_pda", desc = "LP PDA (signer)")]
    #[account(1, writable, name = "matcher_context", desc = "Matcher context account (320 bytes)")]
    Init,

    /// Sync index data from AggregatedRestakingFeed
    #[account(0, writable, name = "matcher_context", desc = "Matcher context account")]
    #[account(1, name = "aggregated_feed", desc = "AggregatedRestakingFeed account")]
    IndexSync,
}
