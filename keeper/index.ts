/**
 * Vigil Keeper — Unified orchestrator
 *
 * Wires the full pipeline:
 *   ncn-monitor → signal-detector → uptime-sync + yield-sync + index-sync
 *
 * All services run in mock mode (Phase 1) — no on-chain transactions.
 * Logs a unified view of the restaking risk pipeline.
 */

import { PublicKey } from "@solana/web3.js";
import { MockNcnDataSource, DEFAULT_NCNS, type NcnConfig } from "./ncn-monitor";
import { SignalDetector, type SignalEvent } from "./signal-detector";
import { MockYieldSource, classifyYieldRegime } from "./yield-sync";
import { SIGNAL_SPREAD_MAP } from "./uptime-sync";
import { MockIndexSource, classifyIndexRegime } from "./index-sync";
import { ReporterFinalizer, runReporterFinalizer } from "./reporter-finalizer";
import { MockMiningTracker } from "./mining-keeper";

// ============================================================================
// Configuration
// ============================================================================

const MONITOR_INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS ?? "5000", 10);
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS ?? "5000", 10);

const SEVERITY_NAMES = ["NONE", "LOW", "HIGH", "CRITICAL"] as const;
const REGIME_NAMES = ["VeryLow", "Low", "Normal", "High", "Extreme"] as const;

// ============================================================================
// Shared State (in production, this would be on-chain account reads)
// ============================================================================

interface NcnState {
  name: string;
  uptimeE6: number;
  signalSeverity: number;
  signalEvents: SignalEvent[];
  yieldApyBps: number;
  yieldRegime: number;
  yieldVarianceBps: number;
}

const ncnStates = new Map<string, NcnState>();

// ============================================================================
// Pipeline
// ============================================================================

function runPipeline(ncnConfigs: NcnConfig[]) {
  const monitor = new MockNcnDataSource(ncnConfigs);
  const detector = new SignalDetector();
  const yieldSources = new Map<string, MockYieldSource>();

  // Initialize yield sources per NCN
  const yieldBaseApys: Record<string, number> = {
    "Pyth Oracle NCN": 800,
    "Wormhole Bridge NCN": 1200,
    "Jito MEV NCN": 600,
  };

  for (const config of ncnConfigs) {
    const baseApy = yieldBaseApys[config.name] ?? 800;
    yieldSources.set(config.ncnAddress.toBase58(), new MockYieldSource(baseApy));
  }

  // Initialize index source (aggregated across all NCNs)
  const indexSource = new MockIndexSource(850, ncnConfigs.length);

  console.log("=".repeat(70));
  console.log("  VIGIL KEEPER — Restaking Risk Pipeline (Mock Mode)");
  console.log("=".repeat(70));
  console.log(`  NCNs: ${ncnConfigs.map((c) => c.name).join(", ")}`);
  console.log(`  Monitor interval: ${MONITOR_INTERVAL_MS / 1000}s`);
  console.log(`  Sync interval:    ${SYNC_INTERVAL_MS / 1000}s`);
  console.log("=".repeat(70));
  console.log();

  // ---- Monitor + Signal Detection tick ----
  const monitorTick = () => {
    const now = Math.floor(Date.now() / 1000);

    for (const config of ncnConfigs) {
      const key = config.ncnAddress.toBase58();
      const sample = monitor.generateSample(config.ncnAddress);

      // Run signal detection
      const signals = detector.detect({
        ncnAddress: key,
        ncnName: config.name,
        uptimeE6: sample.uptimeE6,
        totalRestakedSol: sample.totalRestakedSol,
        restakerCount: sample.restakerCount,
        slashingEvent: sample.slashingEvent,
        timestamp: now,
      });

      const severity = SignalDetector.maxSeverity(signals);

      // Update shared state
      ncnStates.set(key, {
        ...(ncnStates.get(key) ?? {
          name: config.name,
          yieldApyBps: 0,
          yieldRegime: 2,
          yieldVarianceBps: 0,
        }),
        name: config.name,
        uptimeE6: sample.uptimeE6,
        signalSeverity: severity,
        signalEvents: signals,
      });

      // Log
      const uptimePct = (sample.uptimeE6 / 10_000).toFixed(2);
      const tvlSol = (sample.totalRestakedSol / 1e9).toFixed(0);
      let line = `[MONITOR] ${config.name.padEnd(20)} uptime=${uptimePct}%  tvl=${tvlSol} SOL  restakers=${sample.restakerCount}`;

      if (sample.slashingEvent) {
        line += "  *** SLASHING ***";
      }
      if (severity > 0) {
        line += `  signal=${SEVERITY_NAMES[severity]}`;
      }

      console.log(line);

      for (const evt of signals) {
        console.log(
          `  └─ [${SEVERITY_NAMES[evt.severity]}] ${evt.reason}`
        );
      }
    }
  };

  // ---- Yield Sync tick ----
  const yieldTick = () => {
    for (const config of ncnConfigs) {
      const key = config.ncnAddress.toBase58();
      const source = yieldSources.get(key);
      if (!source) continue;

      const snapshot = source.generateSnapshot();
      const regime = classifyYieldRegime(snapshot.yieldVarianceBps);

      // Update shared state
      const state = ncnStates.get(key);
      if (state) {
        state.yieldApyBps = snapshot.currentApyBps;
        state.yieldRegime = regime;
        state.yieldVarianceBps = snapshot.yieldVarianceBps;
      }

      const apyPct = (snapshot.currentApyBps / 100).toFixed(2);
      console.log(
        `[YIELD]   ${config.name.padEnd(20)} APY=${apyPct}%  variance=${snapshot.yieldVarianceBps}bps  regime=${REGIME_NAMES[regime]}`
      );
    }
  };

  // ---- Index Sync tick ----
  const indexSyncTick = () => {
    const snapshot = indexSource.generateSnapshot();
    const regime = classifyIndexRegime(snapshot.indexVarianceBps);
    const tvlSol = (snapshot.totalRestakedSol / 1e9).toFixed(0);

    console.log(
      `[INDEX]   ${"(Aggregated)".padEnd(20)} AvgAPY=${(snapshot.weightedAvgApyBps / 100).toFixed(2)}%  ncns=${snapshot.ncnCount}  tvl=${tvlSol} SOL  variance=${snapshot.indexVarianceBps}bps  regime=${REGIME_NAMES[regime]}`
    );
  };

  // ---- Uptime Sync tick (logs what would be sent on-chain) ----
  const uptimeSyncTick = () => {
    for (const config of ncnConfigs) {
      const key = config.ncnAddress.toBase58();
      const state = ncnStates.get(key);
      if (!state) continue;

      const spreadAdj = SIGNAL_SPREAD_MAP[state.signalSeverity] ?? 0;
      const uptimePct = (state.uptimeE6 / 10_000).toFixed(2);

      console.log(
        `[SYNC]    ${config.name.padEnd(20)} uptime=${uptimePct}%  signal=${SEVERITY_NAMES[state.signalSeverity]}  spread_adj=${spreadAdj}bps  regime=${REGIME_NAMES[state.yieldRegime]}`
      );
    }
    console.log("─".repeat(70));
  };

  // ---- Mining Keeper ----
  const miningTracker = new MockMiningTracker(100);

  // Register mock LPs for each NCN
  for (const config of ncnConfigs) {
    miningTracker.registerLp(
      `lp-${config.name.slice(0, 8)}`,
      0, // Yield matcher type
      1_000_000 // Liquidity
    );
  }

  const miningTick = () => {
    // Use average regime from NCN states
    const regimes = [...ncnStates.values()].map((s) => s.yieldRegime);
    const avgRegime = regimes.length > 0
      ? Math.round(regimes.reduce((a, b) => a + b, 0) / regimes.length)
      : 2;

    miningTracker.recordParticipation(avgRegime);

    const epochResult = miningTracker.finalizeEpoch();
    if (epochResult) {
      console.log(
        `[MINING]  *** Epoch ${epochResult.epoch} finalized — total_weight=${Math.round(epochResult.totalWeight)} ***`
      );
    }

    console.log(
      `[MINING]  epoch=${miningTracker.getCurrentEpoch()} lps=${miningTracker.getLps().length} regime=${REGIME_NAMES[avgRegime]}`
    );
  };

  // ---- Reporter Finalizer ----
  const finalizer = new ReporterFinalizer(3);
  const ncnAddresses = ncnConfigs.map((c) => c.ncnAddress.toBase58());
  const mockReporters = ["reporter-A", "reporter-B", "reporter-C"];

  const finalizerTick = () => {
    const now = Math.floor(Date.now() / 1000);
    for (const ncn of ncnAddresses) {
      const state = ncnStates.get(ncn);
      if (!state) continue;

      // Simulate reporters submitting with slight variance
      for (const reporter of mockReporters) {
        const uptimeNoise = Math.round((Math.random() - 0.5) * 2000);
        const apyNoise = Math.round((Math.random() - 0.5) * 20);
        finalizer.submitReport(
          ncn,
          reporter,
          state.uptimeE6 + uptimeNoise,
          500_000_000_000_000,
          1200,
          state.yieldApyBps + apyNoise
        );
      }

      const result = finalizer.tryFinalize(ncn);
      if (result) {
        const uptimePct = (result.finalizedUptimeE6 / 10_000).toFixed(2);
        const apyPct = (result.finalizedApyBps / 100).toFixed(2);
        console.log(
          `[FINAL]   ${state.name.padEnd(20)} round=${result.round} uptime=${uptimePct}% APY=${apyPct}% (${result.submissions.length} reporters)`
        );
      }
    }
    finalizer.advanceRound();
  };

  // ---- Schedule ----
  // Initial run
  monitorTick();
  yieldTick();
  indexSyncTick();
  miningTick();
  finalizerTick();
  uptimeSyncTick();

  // Recurring
  setInterval(() => {
    monitorTick();
    yieldTick();
    indexSyncTick();
    miningTick();
    finalizerTick();
    uptimeSyncTick();
  }, MONITOR_INTERVAL_MS);
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log("[VIGIL-KEEPER] Initializing...");
  runPipeline(DEFAULT_NCNS);
}

main();
