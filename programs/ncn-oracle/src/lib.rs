use anchor_lang::prelude::*;

declare_id!("NCNRsk1111111111111111111111111111111111111");

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::performance_feed::*;
use instructions::yield_feed::*;
use instructions::aggregated_feed::*;
use instructions::signal::*;

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
}
