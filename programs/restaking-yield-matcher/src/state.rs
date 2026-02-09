// Re-export shared constants and functions from matcher-common
pub use matcher_common::{CTX_SIZE, RETURN_DATA_OFFSET, RETURN_DATA_SIZE, MAGIC_OFFSET, LP_PDA_OFFSET, verify_magic as verify_magic_generic, read_lp_pda};

/// Magic bytes: "RSTKMATC" as u64 LE
pub const YIELD_MATCHER_MAGIC: u64 = 0x5253_544B_4d41_5443;

// Restaking-yield-matcher-specific field offsets
pub const VERSION_OFFSET: usize = 72;                   // u32
pub const MODE_OFFSET: usize = 76;                      // u8: 0=AllNCN, 1=SingleNCN
pub const BASE_SPREAD_OFFSET: usize = 112;              // u32
pub const YIELD_VOL_SPREAD_OFFSET: usize = 116;         // u32: extra spread for yield volatility
pub const MAX_SPREAD_OFFSET: usize = 120;               // u32
pub const IMPACT_K_OFFSET: usize = 124;                 // u32
pub const CURRENT_YIELD_OFFSET: usize = 128;            // u64: current restaking yield in bps
pub const YIELD_MARK_PRICE_OFFSET: usize = 136;         // u64: mark price = yield * 1e6
pub const LAST_UPDATE_SLOT_OFFSET: usize = 144;         // u64
pub const YIELD_REGIME_OFFSET: usize = 152;             // u8: 0=VeryLow..4=Extreme
pub const YIELD_7D_AVG_OFFSET: usize = 160;             // u64
pub const YIELD_30D_AVG_OFFSET: usize = 168;            // u64
pub const LIQUIDITY_OFFSET: usize = 176;                // u128 (16 bytes)
pub const MAX_FILL_OFFSET: usize = 192;                 // u128 (16 bytes)
pub const NCN_YIELD_FEED_OFFSET: usize = 208;           // Pubkey (32): NcnYieldFeed account
pub const NCN_PERFORMANCE_FEED_OFFSET: usize = 240;     // Pubkey (32): NcnPerformanceFeed account
// 272..320 = reserved

/// Yield regime enum — reuses vol-matcher's VolatilityRegime concept
/// applied to restaking yield variance
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum YieldRegime {
    VeryLow = 0,
    Low = 1,
    Normal = 2,
    High = 3,
    Extreme = 4,
}

impl YieldRegime {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::VeryLow,
            1 => Self::Low,
            2 => Self::Normal,
            3 => Self::High,
            4 => Self::Extreme,
            _ => Self::Normal,
        }
    }

    /// Spread multiplier: how much to scale yield vol spread
    /// Same scale as vol-matcher: 50=0.5x, 100=1.0x, 250=2.5x
    pub fn spread_multiplier(&self) -> u64 {
        match self {
            Self::VeryLow => 50,   // 0.5x — very stable yield
            Self::Low => 75,       // 0.75x
            Self::Normal => 100,   // 1.0x
            Self::High => 150,     // 1.5x — yield getting volatile
            Self::Extreme => 250,  // 2.5x — slashing events, NCN instability
        }
    }
}

/// Local convenience wrapper that checks magic against YIELD_MATCHER_MAGIC
pub fn verify_magic(ctx_data: &[u8]) -> bool {
    verify_magic_generic(ctx_data, YIELD_MATCHER_MAGIC)
}
