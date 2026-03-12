use anchor_lang::prelude::*;

declare_id!("NCNRsk1111111111111111111111111111111111111");

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::performance_feed::*;
use instructions::yield_feed::*;
use instructions::aggregated_feed::*;
use instructions::signal::*;
use instructions::reporter::*;

#[program]
pub mod ncn_oracle {
    use super::*;

    // =========================================================================
    // NCN Performance Feed Instructions
    // =========================================================================

    /// Initialize a new NCN performance feed
    pub fn initialize_ncn_performance_feed(
        ctx: Context<InitializeNcnPerformanceFeed>,
        ncn_name: String,
        initial_uptime_e6: u64,
    ) -> Result<()> {
        instructions::performance_feed::initialize_ncn_performance_feed(ctx, ncn_name, initial_uptime_e6)
    }

    /// Keeper records NCN performance data (uptime, TVL, slashing)
    pub fn record_ncn_performance(
        ctx: Context<RecordNcnPerformance>,
        uptime_e6: u64,
        total_restaked_sol: u64,
        restaker_count: u32,
        slashing_event: bool,
    ) -> Result<()> {
        instructions::performance_feed::record_ncn_performance(
            ctx,
            uptime_e6,
            total_restaked_sol,
            restaker_count,
            slashing_event,
        )
    }

    // =========================================================================
    // NCN Yield Feed Instructions
    // =========================================================================

    /// Initialize a new NCN yield feed
    pub fn initialize_ncn_yield_feed(
        ctx: Context<InitializeNcnYieldFeed>,
        initial_apy_bps: u64,
    ) -> Result<()> {
        instructions::yield_feed::initialize_ncn_yield_feed(ctx, initial_apy_bps)
    }

    /// Keeper records NCN yield data with decomposition
    pub fn record_ncn_yield(
        ctx: Context<RecordNcnYield>,
        current_apy_bps: u64,
        base_staking_apy_bps: u64,
        mev_apy_bps: u64,
        restaking_premium_bps: u64,
    ) -> Result<()> {
        instructions::yield_feed::record_ncn_yield(
            ctx,
            current_apy_bps,
            base_staking_apy_bps,
            mev_apy_bps,
            restaking_premium_bps,
        )
    }

    // =========================================================================
    // Aggregated Feed Instructions
    // =========================================================================

    /// Initialize the protocol-level aggregated restaking feed
    pub fn initialize_aggregated_feed(
        ctx: Context<InitializeAggregatedRestakingFeed>,
    ) -> Result<()> {
        instructions::aggregated_feed::initialize_aggregated_feed(ctx)
    }

    /// Add an NCN feed to the aggregated feed
    pub fn add_ncn_feed(
        ctx: Context<AddNcnFeed>,
    ) -> Result<()> {
        instructions::aggregated_feed::add_ncn_feed(ctx)
    }

    /// Update protocol-level aggregated metrics
    pub fn update_aggregated_feed(
        ctx: Context<UpdateAggregatedFeed>,
        total_restaked_sol: u64,
        weighted_avg_apy_bps: u64,
    ) -> Result<()> {
        instructions::aggregated_feed::update_aggregated_feed(ctx, total_restaked_sol, weighted_avg_apy_bps)
    }

    // =========================================================================
    // Signal Instructions
    // =========================================================================

    /// Keeper updates Kalshify-style signal severity
    pub fn update_signal_severity(
        ctx: Context<UpdateSignalSeverity>,
        severity: u8,
    ) -> Result<()> {
        instructions::signal::update_signal_severity(ctx, severity)
    }

    // =========================================================================
    // Multi-Reporter Consensus Instructions
    // =========================================================================

    /// Initialize a reporter registry for an NCN
    pub fn initialize_reporter_registry(
        ctx: Context<InitializeReporterRegistry>,
        min_reporters: u8,
        stake_requirement: u64,
        slash_threshold_bps: u64,
    ) -> Result<()> {
        instructions::reporter::initialize_reporter_registry(ctx, min_reporters, stake_requirement, slash_threshold_bps)
    }

    /// Register a new reporter with staked SOL
    pub fn register_reporter(ctx: Context<RegisterReporter>) -> Result<()> {
        instructions::reporter::register_reporter(ctx)
    }

    /// Reporter submits data for a round
    pub fn submit_report(
        ctx: Context<SubmitReport>,
        round: u64,
        uptime_e6: u64,
        total_restaked_sol: u64,
        restaker_count: u32,
        current_apy_bps: u64,
    ) -> Result<()> {
        instructions::reporter::submit_report(ctx, round, uptime_e6, total_restaked_sol, restaker_count, current_apy_bps)
    }

    /// Finalize a round once enough reporters have submitted
    pub fn finalize_report(ctx: Context<FinalizeReport>) -> Result<()> {
        instructions::reporter::finalize_report(ctx)
    }

    /// Slash a reporter whose submission deviated too far from consensus
    pub fn slash_reporter(ctx: Context<SlashReporter>, reporter_pubkey: Pubkey) -> Result<()> {
        instructions::reporter::slash_reporter(ctx, reporter_pubkey)
    }

    /// Deregister a reporter and return their stake
    pub fn deregister_reporter(ctx: Context<DeregisterReporter>) -> Result<()> {
        instructions::reporter::deregister_reporter(ctx)
    }

    /// Upgrade feeds from SingleAuthority to MultiReporter governance mode
    pub fn upgrade_to_multi_reporter(ctx: Context<UpgradeToMultiReporter>) -> Result<()> {
        instructions::reporter::upgrade_to_multi_reporter(ctx)
    }
}
