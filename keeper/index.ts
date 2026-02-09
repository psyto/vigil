/**
 * Vigil Keeper — Unified orchestrator
 *
 * Wires the full pipeline:
 *   ncn-monitor → signal-detector → uptime-sync + yield-sync
 *
 * All services run in mock mode (Phase 1) — no on-chain transactions.
 * Logs a unified view of the restaking risk pipeline.
 */

import { PublicKey } from "@solana/web3.js";
import { MockNcnDataSource, DEFAULT_NCNS, type NcnConfig } from "./ncn-monitor";
import { SignalDetector, type SignalEvent } from "./signal-detector";
import { MockYieldSource, classifyYieldRegime } from "./yield-sync";
import { SIGNAL_SPREAD_MAP } from "./uptime-sync";

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

  // ---- Schedule ----
  // Initial run
  monitorTick();
  yieldTick();
  uptimeSyncTick();

  // Recurring
  setInterval(() => {
    monitorTick();
    yieldTick();
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
