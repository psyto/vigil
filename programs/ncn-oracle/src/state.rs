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

    /// Governance mode: 0 = SingleAuthority (legacy), 1 = MultiReporter
    pub governance_mode: u8,
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

    /// Governance mode: 0 = SingleAuthority (legacy), 1 = MultiReporter
    pub governance_mode: u8,
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

// =============================================================================
// Multi-Reporter Consensus State
// =============================================================================

/// Reporter registry — manages authorized data reporters for an NCN
#[account]
#[derive(InitSpace)]
pub struct ReporterRegistry {
    /// Governance authority that can manage reporters
    pub authority: Pubkey,

    /// Which NCN this registry is for
    pub ncn_address: Pubkey,

    /// Minimum reporters required for valid consensus
    pub min_reporters: u8,

    /// SOL lamports required to register as reporter
    pub stake_requirement: u64,

    /// Deviation from consensus that triggers slashing (in basis points)
    pub slash_threshold_bps: u64,

    /// Registered reporters (max 16)
    #[max_len(16)]
    pub reporters: Vec<ReporterInfo>,

    /// Whether registry is active
    pub is_active: bool,

    /// PDA bump seed
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ReporterInfo {
    /// Reporter's identity
    pub pubkey: Pubkey,

    /// PDA holding reporter's staked SOL
    pub stake_account: Pubkey,

    /// Total lifetime submissions
    pub total_reports: u64,

    /// Times slashed
    pub slashing_count: u32,

    /// Last submission timestamp
    pub last_report_time: i64,

    /// Whether reporter is active
    pub is_active: bool,
}

/// Pending submission — collects reports from multiple reporters per round
#[account]
#[derive(InitSpace)]
pub struct PendingSubmission {
    /// NCN this submission is for
    pub ncn_address: Pubkey,

    /// Round number (incrementing counter)
    pub round: u64,

    /// Individual reporter submissions (max 16)
    #[max_len(16)]
    pub submissions: Vec<ReporterSubmission>,

    /// Whether this round has been finalized
    pub is_finalized: bool,

    /// Finalized values (set after finalization)
    pub finalized_uptime_e6: u64,
    pub finalized_restaked_sol: u64,
    pub finalized_restaker_count: u32,
    pub finalized_apy_bps: u64,
    pub finalized_time: i64,

    /// PDA bump seed
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct ReporterSubmission {
    /// Reporter who submitted
    pub reporter: Pubkey,

    /// Reported uptime (0-1,000,000)
    pub uptime_e6: u64,

    /// Reported total restaked SOL
    pub total_restaked_sol: u64,

    /// Reported restaker count
    pub restaker_count: u32,

    /// Reported current APY in bps
    pub current_apy_bps: u64,

    /// Submission timestamp
    pub timestamp: i64,
}

// =============================================================================
// Impl blocks
// =============================================================================

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

impl ReporterRegistry {
    pub fn find_reporter(&self, pubkey: &Pubkey) -> Option<usize> {
        self.reporters.iter().position(|r| r.pubkey == *pubkey && r.is_active)
    }

    pub fn active_reporter_count(&self) -> usize {
        self.reporters.iter().filter(|r| r.is_active).count()
    }
}

impl PendingSubmission {
    pub fn has_reporter_submitted(&self, reporter: &Pubkey) -> bool {
        self.submissions.iter().any(|s| s.reporter == *reporter)
    }

    /// Compute median of u64 values
    pub fn median_u64(values: &mut Vec<u64>) -> u64 {
        values.sort();
        let len = values.len();
        if len == 0 { return 0; }
        if len % 2 == 0 {
            (values[len / 2 - 1] + values[len / 2]) / 2
        } else {
            values[len / 2]
        }
    }

    /// Compute median of u32 values
    pub fn median_u32(values: &mut Vec<u32>) -> u32 {
        values.sort();
        let len = values.len();
        if len == 0 { return 0; }
        if len % 2 == 0 {
            (values[len / 2 - 1] + values[len / 2]) / 2
        } else {
            values[len / 2]
        }
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
            governance_mode: 0,
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
            governance_mode: 0,
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

    // =========================================================================
    // PendingSubmission::median_u64
    // =========================================================================

    #[test]
    fn test_median_u64_empty() {
        assert_eq!(PendingSubmission::median_u64(&mut vec![]), 0);
    }

    #[test]
    fn test_median_u64_single() {
        assert_eq!(PendingSubmission::median_u64(&mut vec![42]), 42);
    }

    #[test]
    fn test_median_u64_odd_count() {
        assert_eq!(PendingSubmission::median_u64(&mut vec![10, 30, 20]), 20);
    }

    #[test]
    fn test_median_u64_even_count() {
        // [10, 20, 30, 40] -> median = (20 + 30) / 2 = 25
        assert_eq!(PendingSubmission::median_u64(&mut vec![40, 10, 30, 20]), 25);
    }

    #[test]
    fn test_median_u64_identical_values() {
        assert_eq!(PendingSubmission::median_u64(&mut vec![100, 100, 100]), 100);
    }

    #[test]
    fn test_median_u64_unsorted_input() {
        assert_eq!(PendingSubmission::median_u64(&mut vec![5, 1, 3, 2, 4]), 3);
    }

    #[test]
    fn test_median_u64_large_values() {
        let mut vals = vec![990_000u64, 995_000, 993_000, 997_000, 991_000];
        assert_eq!(PendingSubmission::median_u64(&mut vals), 993_000);
    }

    // =========================================================================
    // PendingSubmission::median_u32
    // =========================================================================

    #[test]
    fn test_median_u32_empty() {
        assert_eq!(PendingSubmission::median_u32(&mut vec![]), 0);
    }

    #[test]
    fn test_median_u32_single() {
        assert_eq!(PendingSubmission::median_u32(&mut vec![7]), 7);
    }

    #[test]
    fn test_median_u32_odd_count() {
        assert_eq!(PendingSubmission::median_u32(&mut vec![100, 300, 200]), 200);
    }

    #[test]
    fn test_median_u32_even_count() {
        assert_eq!(PendingSubmission::median_u32(&mut vec![10, 40, 20, 30]), 25);
    }

    // =========================================================================
    // ReporterRegistry
    // =========================================================================

    fn make_registry() -> ReporterRegistry {
        ReporterRegistry {
            authority: Pubkey::default(),
            ncn_address: Pubkey::default(),
            min_reporters: 3,
            stake_requirement: 1_000_000_000,
            slash_threshold_bps: 500,
            reporters: Vec::new(),
            is_active: true,
            bump: 255,
        }
    }

    fn make_reporter(active: bool) -> ReporterInfo {
        ReporterInfo {
            pubkey: Pubkey::new_unique(),
            stake_account: Pubkey::new_unique(),
            total_reports: 0,
            slashing_count: 0,
            last_report_time: 0,
            is_active: active,
        }
    }

    #[test]
    fn test_find_reporter_empty() {
        let registry = make_registry();
        assert_eq!(registry.find_reporter(&Pubkey::new_unique()), None);
    }

    #[test]
    fn test_find_reporter_active() {
        let mut registry = make_registry();
        let reporter = make_reporter(true);
        let pk = reporter.pubkey;
        registry.reporters.push(reporter);
        assert_eq!(registry.find_reporter(&pk), Some(0));
    }

    #[test]
    fn test_find_reporter_inactive() {
        let mut registry = make_registry();
        let reporter = make_reporter(false);
        let pk = reporter.pubkey;
        registry.reporters.push(reporter);
        assert_eq!(registry.find_reporter(&pk), None);
    }

    #[test]
    fn test_active_reporter_count() {
        let mut registry = make_registry();
        registry.reporters.push(make_reporter(true));
        registry.reporters.push(make_reporter(false));
        registry.reporters.push(make_reporter(true));
        assert_eq!(registry.active_reporter_count(), 2);
    }

    #[test]
    fn test_active_reporter_count_all_inactive() {
        let mut registry = make_registry();
        registry.reporters.push(make_reporter(false));
        registry.reporters.push(make_reporter(false));
        assert_eq!(registry.active_reporter_count(), 0);
    }

    // =========================================================================
    // PendingSubmission::has_reporter_submitted
    // =========================================================================

    #[test]
    fn test_has_reporter_submitted_empty() {
        let ps = PendingSubmission {
            ncn_address: Pubkey::default(),
            round: 0,
            submissions: Vec::new(),
            is_finalized: false,
            finalized_uptime_e6: 0,
            finalized_restaked_sol: 0,
            finalized_restaker_count: 0,
            finalized_apy_bps: 0,
            finalized_time: 0,
            bump: 255,
        };
        assert!(!ps.has_reporter_submitted(&Pubkey::new_unique()));
    }

    #[test]
    fn test_has_reporter_submitted_found() {
        let reporter = Pubkey::new_unique();
        let ps = PendingSubmission {
            ncn_address: Pubkey::default(),
            round: 0,
            submissions: vec![ReporterSubmission {
                reporter,
                uptime_e6: 990_000,
                total_restaked_sol: 500_000_000,
                restaker_count: 100,
                current_apy_bps: 800,
                timestamp: 1_700_000_000,
            }],
            is_finalized: false,
            finalized_uptime_e6: 0,
            finalized_restaked_sol: 0,
            finalized_restaker_count: 0,
            finalized_apy_bps: 0,
            finalized_time: 0,
            bump: 255,
        };
        assert!(ps.has_reporter_submitted(&reporter));
    }

    #[test]
    fn test_has_reporter_submitted_not_found() {
        let reporter = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let ps = PendingSubmission {
            ncn_address: Pubkey::default(),
            round: 0,
            submissions: vec![ReporterSubmission {
                reporter,
                uptime_e6: 990_000,
                total_restaked_sol: 500_000_000,
                restaker_count: 100,
                current_apy_bps: 800,
                timestamp: 1_700_000_000,
            }],
            is_finalized: false,
            finalized_uptime_e6: 0,
            finalized_restaked_sol: 0,
            finalized_restaker_count: 0,
            finalized_apy_bps: 0,
            finalized_time: 0,
            bump: 255,
        };
        assert!(!ps.has_reporter_submitted(&other));
    }
}
