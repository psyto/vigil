use shank::ShankInstruction;

#[derive(ShankInstruction)]
pub enum UptimeMatcherInstruction {
    /// Execute match — probability-based pricing with edge spread for NCN uptime
    #[account(0, signer, name = "lp_pda", desc = "LP PDA (must be signer)")]
    #[account(1, writable, name = "matcher_context", desc = "Matcher context account (320 bytes)")]
    Match,

    /// Initialize NCN uptime matcher context
    #[account(0, name = "lp_pda", desc = "LP PDA to store")]
    #[account(1, writable, name = "matcher_context", desc = "Matcher context account (320 bytes, writable)")]
    Init,

    /// Sync uptime probability from NCN oracle
    #[account(0, writable, name = "matcher_context", desc = "Matcher context account")]
    #[account(1, name = "ncn_oracle", desc = "NcnPerformanceFeed account")]
    UptimeSync,

    /// Resolve NCN slashing event (SLASHED/SAFE)
    #[account(0, writable, name = "matcher_context", desc = "Matcher context account")]
    #[account(1, signer, name = "ncn_oracle", desc = "NCN oracle (must be signer)")]
    Resolve,
}
