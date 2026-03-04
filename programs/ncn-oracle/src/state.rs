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

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // Helper: build a default NcnPerformanceFeed for testing
    // =========================================================================
    fn make_perf_feed() -> NcnPerformanceFeed {
        NcnPerformanceFeed {
            authority: Pubkey::default(),
            ncn_address: Pubkey::default(),
            ncn_name: "Test NCN".to_string(),
            uptime_probability_e6: 995_000,
            total_slashing_events: 0,
            last_slashing_time: 0,
            total_restaked_sol: 500_000_000_000_000,
            restaker_count: 1200,
            performance_history: Vec::new(),
            signal_severity: 0,
            sovereign_infra_score: 0,
            is_active: true,
            last_updated: 1_700_000_000,
            bump: 255,
        }
    }

    fn make_yield_feed() -> NcnYieldFeed {
        NcnYieldFeed {
            authority: Pubkey::default(),
            ncn_address: Pubkey::default(),
            current_apy_bps: 800,
            apy_7d_avg: 780,
            apy_30d_avg: 790,
            yield_variance_bps: 100,
            yield_regime: 2,
            yield_history: Vec::new(),
            base_staking_apy_bps: 600,
            mev_apy_bps: 100,
            restaking_premium_bps: 100,
            is_active: true,
            last_updated: 1_700_000_000,
            bump: 255,
        }
    }

    // =========================================================================
    // NcnPerformanceFeed::was_recently_slashed
    // =========================================================================

    #[test]
    fn test_no_slashing_events_returns_false() {
        let feed = make_perf_feed();
        assert!(!feed.was_recently_slashed(1_700_000_000));
    }

    #[test]
    fn test_recent_slashing_returns_true() {
        let mut feed = make_perf_feed();
        feed.total_slashing_events = 1;
        feed.last_slashing_time = 1_700_000_000 - 3600; // 1 hour ago
        assert!(feed.was_recently_slashed(1_700_000_000));
    }

    #[test]
    fn test_old_slashing_returns_false() {
        let mut feed = make_perf_feed();
        feed.total_slashing_events = 1;
        feed.last_slashing_time = 1_700_000_000 - 90_000; // >24h ago
        assert!(!feed.was_recently_slashed(1_700_000_000));
    }

    #[test]
    fn test_slashing_exactly_24h_ago_returns_false() {
        let mut feed = make_perf_feed();
        feed.total_slashing_events = 1;
        feed.last_slashing_time = 1_700_000_000 - 86_400; // exactly 24h
        // current - last = 86_400, which is NOT < 86_400
        assert!(!feed.was_recently_slashed(1_700_000_000));
    }

    #[test]
    fn test_slashing_just_under_24h_returns_true() {
        let mut feed = make_perf_feed();
        feed.total_slashing_events = 3;
        feed.last_slashing_time = 1_700_000_000 - 86_399;
        assert!(feed.was_recently_slashed(1_700_000_000));
    }

    // =========================================================================
    // NcnPerformanceFeed::average_uptime
    // =========================================================================

    #[test]
    fn test_average_uptime_empty_history_returns_current() {
        let feed = make_perf_feed();
        assert_eq!(feed.average_uptime(), 995_000);
    }

    #[test]
    fn test_average_uptime_single_sample() {
        let mut feed = make_perf_feed();
        feed.performance_history.push(NcnPerformanceSample {
            uptime_e6: 990_000,
            total_restaked_sol: 0,
            restaker_count: 0,
            timestamp: 0,
        });
        assert_eq!(feed.average_uptime(), 990_000);
    }

    #[test]
    fn test_average_uptime_multiple_samples() {
        let mut feed = make_perf_feed();
        for uptime in [990_000u64, 995_000, 1_000_000] {
            feed.performance_history.push(NcnPerformanceSample {
                uptime_e6: uptime,
                total_restaked_sol: 0,
                restaker_count: 0,
                timestamp: 0,
            });
        }
        // (990_000 + 995_000 + 1_000_000) / 3 = 995_000
        assert_eq!(feed.average_uptime(), 995_000);
    }

    #[test]
    fn test_average_uptime_varied_samples() {
        let mut feed = make_perf_feed();
        for uptime in [500_000u64, 600_000, 700_000, 800_000] {
            feed.performance_history.push(NcnPerformanceSample {
                uptime_e6: uptime,
                total_restaked_sol: 0,
                restaker_count: 0,
                timestamp: 0,
            });
        }
        // (500000 + 600000 + 700000 + 800000) / 4 = 650_000
        assert_eq!(feed.average_uptime(), 650_000);
    }

    // =========================================================================
    // NcnYieldFeed::classify_regime
    // =========================================================================

    #[test]
    fn test_classify_regime_very_low() {
        assert_eq!(NcnYieldFeed::classify_regime(0), 0);
        assert_eq!(NcnYieldFeed::classify_regime(25), 0);
        assert_eq!(NcnYieldFeed::classify_regime(50), 0);
    }

    #[test]
    fn test_classify_regime_low() {
        assert_eq!(NcnYieldFeed::classify_regime(51), 1);
        assert_eq!(NcnYieldFeed::classify_regime(100), 1);
        assert_eq!(NcnYieldFeed::classify_regime(150), 1);
    }

    #[test]
    fn test_classify_regime_normal() {
        assert_eq!(NcnYieldFeed::classify_regime(151), 2);
        assert_eq!(NcnYieldFeed::classify_regime(250), 2);
        assert_eq!(NcnYieldFeed::classify_regime(400), 2);
    }

    #[test]
    fn test_classify_regime_high() {
        assert_eq!(NcnYieldFeed::classify_regime(401), 3);
        assert_eq!(NcnYieldFeed::classify_regime(600), 3);
        assert_eq!(NcnYieldFeed::classify_regime(800), 3);
    }

    #[test]
    fn test_classify_regime_extreme() {
        assert_eq!(NcnYieldFeed::classify_regime(801), 4);
        assert_eq!(NcnYieldFeed::classify_regime(1000), 4);
        assert_eq!(NcnYieldFeed::classify_regime(10_000), 4);
    }

    // =========================================================================
    // NcnYieldFeed::calculate_variance
    // =========================================================================

    #[test]
    fn test_variance_empty_history() {
        let feed = make_yield_feed();
        assert_eq!(feed.calculate_variance(), 0);
    }

    #[test]
    fn test_variance_single_sample() {
        let mut feed = make_yield_feed();
        feed.yield_history.push(YieldSample {
            apy_bps: 800,
            variance_bps: 0,
            timestamp: 0,
        });
        assert_eq!(feed.calculate_variance(), 0);
    }

    #[test]
    fn test_variance_identical_samples() {
        let mut feed = make_yield_feed();
        for _ in 0..5 {
            feed.yield_history.push(YieldSample {
                apy_bps: 800,
                variance_bps: 0,
                timestamp: 0,
            });
        }
        assert_eq!(feed.calculate_variance(), 0);
    }

    #[test]
    fn test_variance_known_values() {
        let mut feed = make_yield_feed();
        // Values: 800, 810, 790, 820, 780
        for apy in [800u64, 810, 790, 820, 780] {
            feed.yield_history.push(YieldSample {
                apy_bps: apy,
                variance_bps: 0,
                timestamp: 0,
            });
        }
        // avg = 800
        // diffs: 0, 10, 10, 20, 20
        // squared: 0, 100, 100, 400, 400
        // variance = 1000 / 4 = 250
        // sqrt(250) ~= 15
        let v = feed.calculate_variance();
        assert_eq!(v, 15); // (250.0_f64).sqrt() as u64 = 15
    }

    #[test]
    fn test_variance_high_spread() {
        let mut feed = make_yield_feed();
        for apy in [200u64, 1000] {
            feed.yield_history.push(YieldSample {
                apy_bps: apy,
                variance_bps: 0,
                timestamp: 0,
            });
        }
        // avg = 600
        // diffs: 400, 400
        // squared: 160000, 160000
        // variance = 320000 / 1 = 320000
        // sqrt(320000) ~= 565
        let v = feed.calculate_variance();
        assert_eq!(v, 565); // (320000.0_f64).sqrt() as u64
    }

    // =========================================================================
    // AggregatedRestakingFeed::active_count
    // =========================================================================

    #[test]
    fn test_active_count() {
        let feed = AggregatedRestakingFeed {
            authority: Pubkey::default(),
            total_restaked_sol: 0,
            weighted_avg_apy_bps: 0,
            ncn_count: 5,
            ncn_feeds: Vec::new(),
            is_active: true,
            last_updated: 0,
            bump: 255,
        };
        assert_eq!(feed.active_count(), 5);
    }

    #[test]
    fn test_active_count_zero() {
        let feed = AggregatedRestakingFeed {
            authority: Pubkey::default(),
            total_restaked_sol: 0,
            weighted_avg_apy_bps: 0,
            ncn_count: 0,
            ncn_feeds: Vec::new(),
            is_active: true,
            last_updated: 0,
            bump: 255,
        };
        assert_eq!(feed.active_count(), 0);
    }
}
