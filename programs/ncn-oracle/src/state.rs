use anchor_lang::prelude::*;

// =============================================================================
// NCN Oracle State — Tracks NCN performance and yield data for restaking risk
// =============================================================================

/// Per-NCN performance feed — tracks uptime, slashing, TVL
#[account]
#[derive(InitSpace)]
pub struct NcnPerformanceFeed {
    /// Authority that can update this feed (keeper)
    pub authority: Pubkey,

    /// Fragmetric/Jito NCN identifier
    pub ncn_address: Pubkey,

    /// Human-readable NCN name (e.g., "Pyth Oracle NCN", "Wormhole Bridge NCN")
    #[max_len(32)]
    pub ncn_name: String,

    /// Current uptime as probability (0-1,000,000 = 0%-100%)
    /// Same scale as event-matcher
    pub uptime_probability_e6: u64,

    /// Total slashing events observed
    pub total_slashing_events: u32,

    /// Timestamp of last slashing event
    pub last_slashing_time: i64,

    /// Total restaked SOL in this NCN (in lamports)
    pub total_restaked_sol: u64,

    /// Number of restakers in this NCN
    pub restaker_count: u32,

    /// Performance history (max 168 = 7 days hourly)
    #[max_len(168)]
    pub performance_history: Vec<NcnPerformanceSample>,

    /// Kalshify-style signal severity (0=NONE, 1=LOW, 2=HIGH, 3=CRITICAL)
    pub signal_severity: u8,

    /// Sovereign infrastructure score for the NCN operator
    pub sovereign_infra_score: u16,

    /// Whether feed is active
    pub is_active: bool,

    /// Last update timestamp
    pub last_updated: i64,

    /// PDA bump seed
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct NcnPerformanceSample {
    /// Uptime probability at sample time (0-1,000,000)
    pub uptime_e6: u64,
    /// Total restaked SOL at sample time
    pub total_restaked_sol: u64,
    /// Restaker count at sample time
    pub restaker_count: u32,
    /// Unix timestamp
    pub timestamp: i64,
}

/// Per-NCN yield feed — tracks APY, variance, yield decomposition
#[account]
#[derive(InitSpace)]
pub struct NcnYieldFeed {
    /// Authority that can update this feed (keeper)
    pub authority: Pubkey,

    /// Fragmetric/Jito NCN identifier
    pub ncn_address: Pubkey,

    /// Current APY in basis points (e.g., 800 = 8%)
    pub current_apy_bps: u64,

    /// 7-day average APY in bps
    pub apy_7d_avg: u64,

    /// 30-day average APY in bps
    pub apy_30d_avg: u64,

    /// Annualized yield variance in bps
    pub yield_variance_bps: u64,

    /// Yield regime: 0=VeryLow, 1=Low, 2=Normal, 3=High, 4=Extreme
    pub yield_regime: u8,

    /// Yield history (max 168 = 7 days hourly)
    #[max_len(168)]
    pub yield_history: Vec<YieldSample>,

    /// Base SOL staking APY component in bps
    pub base_staking_apy_bps: u64,

    /// MEV APY component in bps
    pub mev_apy_bps: u64,

    /// Extra yield from NCN security in bps
    pub restaking_premium_bps: u64,

    /// Whether feed is active
    pub is_active: bool,

    /// Last update timestamp
    pub last_updated: i64,

    /// PDA bump seed
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct YieldSample {
    /// APY in bps at sample time
    pub apy_bps: u64,
    /// Yield variance at sample time
    pub variance_bps: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

/// Protocol-level aggregated restaking feed
#[account]
#[derive(InitSpace)]
pub struct AggregatedRestakingFeed {
    /// Authority that can manage this feed
    pub authority: Pubkey,

    /// Total restaked SOL across all NCNs (in lamports)
    pub total_restaked_sol: u64,

    /// TVL-weighted average APY across all NCNs in bps
    pub weighted_avg_apy_bps: u64,

    /// Number of tracked NCNs
    pub ncn_count: u32,

    /// References to individual NcnPerformanceFeed accounts (max 32)
    #[max_len(32)]
    pub ncn_feeds: Vec<Pubkey>,

    /// Whether feed is active
    pub is_active: bool,

    /// Last update timestamp
    pub last_updated: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl NcnPerformanceFeed {
    /// Check if the NCN has been slashed recently (within last 24h)
    pub fn was_recently_slashed(&self, current_time: i64) -> bool {
        if self.total_slashing_events == 0 {
            return false;
        }
        current_time - self.last_slashing_time < 86_400
    }

    /// Get average uptime from history
    pub fn average_uptime(&self) -> u64 {
        if self.performance_history.is_empty() {
            return self.uptime_probability_e6;
        }
        let sum: u128 = self.performance_history.iter().map(|s| s.uptime_e6 as u128).sum();
        (sum / self.performance_history.len() as u128) as u64
    }
}

impl NcnYieldFeed {
    /// Classify yield regime based on variance
    pub fn classify_regime(variance_bps: u64) -> u8 {
        match variance_bps {
            0..=50 => 0,      // VeryLow
            51..=150 => 1,    // Low
            151..=400 => 2,   // Normal
            401..=800 => 3,   // High
            _ => 4,           // Extreme
        }
    }

    /// Calculate yield variance from history
    pub fn calculate_variance(&self) -> u64 {
        if self.yield_history.len() < 2 {
            return 0;
        }

        let avg = self.yield_history.iter().map(|s| s.apy_bps as u128).sum::<u128>()
            / self.yield_history.len() as u128;

        let variance: u128 = self
            .yield_history
            .iter()
            .map(|s| {
                let diff = if (s.apy_bps as u128) >= avg {
                    (s.apy_bps as u128) - avg
                } else {
                    avg - (s.apy_bps as u128)
                };
                diff * diff
            })
            .sum::<u128>()
            / (self.yield_history.len() as u128 - 1);

        // Return square root approximation in bps
        (variance as f64).sqrt() as u64
    }
}

impl AggregatedRestakingFeed {
    /// Get number of active NCN feeds
    pub fn active_count(&self) -> u32 {
        self.ncn_count
    }
}
