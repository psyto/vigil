// Re-export shared constants and functions from matcher-common
pub use matcher_common::{CTX_SIZE, RETURN_DATA_OFFSET, RETURN_DATA_SIZE, MAGIC_OFFSET, LP_PDA_OFFSET, verify_magic as verify_magic_generic, read_lp_pda};

/// Magic bytes: "IDXMATC\0" as u64 LE
pub const INDEX_MATCHER_MAGIC: u64 = 0x4944_584D_4154_4300;

// Index-matcher-specific field offsets
pub const VERSION_OFFSET: usize = 72;                   // u32
pub const MODE_OFFSET: usize = 76;                      // u8: 0=FullIndex, 1=ExclusionIndex
pub const BASE_SPREAD_OFFSET: usize = 112;              // u32
pub const INDEX_VOL_SPREAD_OFFSET: usize = 116;         // u32: extra spread for index variance
pub const MAX_SPREAD_OFFSET: usize = 120;               // u32
pub const IMPACT_K_OFFSET: usize = 124;                 // u32
pub const WEIGHTED_AVG_APY_OFFSET: usize = 128;         // u64: TVL-weighted avg APY from AggregatedRestakingFeed
pub const INDEX_MARK_PRICE_OFFSET: usize = 136;         // u64: mark price = weighted_avg_apy * 1e6
pub const LAST_UPDATE_SLOT_OFFSET: usize = 144;         // u64
pub const INDEX_REGIME_OFFSET: usize = 152;             // u8: 0=VeryLow..4=Extreme
pub const TOTAL_RESTAKED_SOL_OFFSET: usize = 160;       // u64
pub const NCN_COUNT_OFFSET: usize = 168;                // u32
pub const MIN_NCN_COUNT_OFFSET: usize = 172;            // u32: minimum NCNs for valid index
pub const LIQUIDITY_OFFSET: usize = 176;                // u128 (16 bytes)
pub const MAX_FILL_OFFSET: usize = 192;                 // u128 (16 bytes)
pub const AGGREGATED_FEED_OFFSET: usize = 208;          // Pubkey (32): AggregatedRestakingFeed account
// 240..320 = reserved

/// Index regime enum — reuses yield regime concept for index-level variance
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum IndexRegime {
    VeryLow = 0,
    Low = 1,
    Normal = 2,
    High = 3,
    Extreme = 4,
}

impl IndexRegime {
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

    /// Spread multiplier: how much to scale index vol spread
    /// Same scale as yield-matcher: 50=0.5x, 100=1.0x, 250=2.5x
    pub fn spread_multiplier(&self) -> u64 {
        match self {
            Self::VeryLow => 50,   // 0.5x — very stable index
            Self::Low => 75,       // 0.75x
            Self::Normal => 100,   // 1.0x
            Self::High => 150,     // 1.5x — index getting volatile
            Self::Extreme => 250,  // 2.5x — correlated NCN instability
        }
    }
}

/// Local convenience wrapper that checks magic against INDEX_MATCHER_MAGIC
pub fn verify_magic(ctx_data: &[u8]) -> bool {
    verify_magic_generic(ctx_data, INDEX_MATCHER_MAGIC)
}
