/**
 * Signal Detector — Kalshify-style anomaly detection for restaking risk
 *
 * Monitors for:
 * - Large unstaking events (whale withdrawal from NCN)
 * - Uptime drops below threshold
 * - Slashing events on other NCNs (contagion risk)
 * - Rapid TVL decline
 *
 * Outputs signal severity: NONE(0), LOW(1), HIGH(2), CRITICAL(3)
 * Pushes signal to both matchers for spread widening
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

// ============================================================================
// Signal Severity
// ============================================================================

export const SIGNAL_NONE = 0;
export const SIGNAL_LOW = 1;
export const SIGNAL_HIGH = 2;
export const SIGNAL_CRITICAL = 3;

export type SignalSeverity =
  | typeof SIGNAL_NONE
  | typeof SIGNAL_LOW
  | typeof SIGNAL_HIGH
  | typeof SIGNAL_CRITICAL;

export interface SignalEvent {
  ncnAddress: string;
  severity: SignalSeverity;
  reason: string;
  timestamp: number;
  metrics: Record<string, number>;
}

// ============================================================================
// Anomaly Detection Thresholds
// ============================================================================

interface DetectorConfig {
  // TVL decline thresholds (percentage drop in 1 hour)
  tvlDropLow: number; // e.g., 5%
  tvlDropHigh: number; // e.g., 15%
  tvlDropCritical: number; // e.g., 30%

  // Uptime thresholds
  uptimeWarnThreshold: number; // e.g., 990_000 (99.0%)
  uptimeAlertThreshold: number; // e.g., 950_000 (95.0%)
  uptimeCriticalThreshold: number; // e.g., 900_000 (90.0%)

  // Restaker drain (% of restakers leaving in 1 hour)
  restakerDrainLow: number; // e.g., 3%
  restakerDrainHigh: number; // e.g., 10%
  restakerDrainCritical: number; // e.g., 25%

  // Contagion: slashing events on other NCNs in last hour
  contagionThreshold: number; // e.g., 2 events
}

const DEFAULT_CONFIG: DetectorConfig = {
  tvlDropLow: 5,
  tvlDropHigh: 15,
  tvlDropCritical: 30,
  uptimeWarnThreshold: 990_000,
  uptimeAlertThreshold: 950_000,
  uptimeCriticalThreshold: 900_000,
  restakerDrainLow: 3,
  restakerDrainHigh: 10,
  restakerDrainCritical: 25,
  contagionThreshold: 2,
};

// ============================================================================
// NCN Snapshot (from ncn-monitor)
// ============================================================================

interface NcnSnapshot {
  ncnAddress: string;
  ncnName: string;
  uptimeE6: number;
  totalRestakedSol: number;
  restakerCount: number;
  slashingEvent: boolean;
  timestamp: number;
}

// ============================================================================
// Signal Detector
// ============================================================================

export class SignalDetector {
  private config: DetectorConfig;
  private history: Map<string, NcnSnapshot[]> = new Map();
  private recentSlashings: { ncnAddress: string; timestamp: number }[] =
    [];

  constructor(config: DetectorConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  /** Process a new NCN snapshot and detect anomalies */
  detect(snapshot: NcnSnapshot): SignalEvent[] {
    const key = snapshot.ncnAddress;
    const events: SignalEvent[] = [];

    // Store history
    if (!this.history.has(key)) {
      this.history.set(key, []);
    }
    const ncnHistory = this.history.get(key)!;
    ncnHistory.push(snapshot);

    // Keep last hour of history
    const oneHourAgo = snapshot.timestamp - 3600;
    while (ncnHistory.length > 0 && ncnHistory[0].timestamp < oneHourAgo) {
      ncnHistory.shift();
    }

    // Track slashing events across all NCNs
    if (snapshot.slashingEvent) {
      this.recentSlashings.push({
        ncnAddress: key,
        timestamp: snapshot.timestamp,
      });
    }
    this.recentSlashings = this.recentSlashings.filter(
      (s) => s.timestamp >= oneHourAgo
    );

    // --- Detection 1: Uptime drop ---
    if (snapshot.uptimeE6 < this.config.uptimeCriticalThreshold) {
      events.push({
        ncnAddress: key,
        severity: SIGNAL_CRITICAL,
        reason: `Uptime below critical threshold: ${(snapshot.uptimeE6 / 10_000).toFixed(2)}%`,
        timestamp: snapshot.timestamp,
        metrics: { uptimeE6: snapshot.uptimeE6 },
      });
    } else if (
      snapshot.uptimeE6 < this.config.uptimeAlertThreshold
    ) {
      events.push({
        ncnAddress: key,
        severity: SIGNAL_HIGH,
        reason: `Uptime below alert threshold: ${(snapshot.uptimeE6 / 10_000).toFixed(2)}%`,
        timestamp: snapshot.timestamp,
        metrics: { uptimeE6: snapshot.uptimeE6 },
      });
    } else if (snapshot.uptimeE6 < this.config.uptimeWarnThreshold) {
      events.push({
        ncnAddress: key,
        severity: SIGNAL_LOW,
        reason: `Uptime below warn threshold: ${(snapshot.uptimeE6 / 10_000).toFixed(2)}%`,
        timestamp: snapshot.timestamp,
        metrics: { uptimeE6: snapshot.uptimeE6 },
      });
    }

    // --- Detection 2: TVL decline ---
    if (ncnHistory.length >= 2) {
      const oldest = ncnHistory[0];
      if (oldest.totalRestakedSol > 0) {
        const tvlDrop =
          ((oldest.totalRestakedSol - snapshot.totalRestakedSol) /
            oldest.totalRestakedSol) *
          100;

        if (tvlDrop >= this.config.tvlDropCritical) {
          events.push({
            ncnAddress: key,
            severity: SIGNAL_CRITICAL,
            reason: `TVL dropped ${tvlDrop.toFixed(1)}% in 1h`,
            timestamp: snapshot.timestamp,
            metrics: {
              tvlDropPercent: tvlDrop,
              currentTvl: snapshot.totalRestakedSol,
            },
          });
        } else if (tvlDrop >= this.config.tvlDropHigh) {
          events.push({
            ncnAddress: key,
            severity: SIGNAL_HIGH,
            reason: `TVL dropped ${tvlDrop.toFixed(1)}% in 1h`,
            timestamp: snapshot.timestamp,
            metrics: {
              tvlDropPercent: tvlDrop,
              currentTvl: snapshot.totalRestakedSol,
            },
          });
        } else if (tvlDrop >= this.config.tvlDropLow) {
          events.push({
            ncnAddress: key,
            severity: SIGNAL_LOW,
            reason: `TVL dropped ${tvlDrop.toFixed(1)}% in 1h`,
            timestamp: snapshot.timestamp,
            metrics: {
              tvlDropPercent: tvlDrop,
              currentTvl: snapshot.totalRestakedSol,
            },
          });
        }
      }
    }

    // --- Detection 3: Restaker drain ---
    if (ncnHistory.length >= 2) {
      const oldest = ncnHistory[0];
      if (oldest.restakerCount > 0) {
        const drain =
          ((oldest.restakerCount - snapshot.restakerCount) /
            oldest.restakerCount) *
          100;

        if (drain >= this.config.restakerDrainCritical) {
          events.push({
            ncnAddress: key,
            severity: SIGNAL_CRITICAL,
            reason: `${drain.toFixed(1)}% restakers left in 1h`,
            timestamp: snapshot.timestamp,
            metrics: {
              drainPercent: drain,
              currentCount: snapshot.restakerCount,
            },
          });
        } else if (drain >= this.config.restakerDrainHigh) {
          events.push({
            ncnAddress: key,
            severity: SIGNAL_HIGH,
            reason: `${drain.toFixed(1)}% restakers left in 1h`,
            timestamp: snapshot.timestamp,
            metrics: {
              drainPercent: drain,
              currentCount: snapshot.restakerCount,
            },
          });
        } else if (drain >= this.config.restakerDrainLow) {
          events.push({
            ncnAddress: key,
            severity: SIGNAL_LOW,
            reason: `${drain.toFixed(1)}% restakers left in 1h`,
            timestamp: snapshot.timestamp,
            metrics: {
              drainPercent: drain,
              currentCount: snapshot.restakerCount,
            },
          });
        }
      }
    }

    // --- Detection 4: Slashing contagion ---
    const otherSlashings = this.recentSlashings.filter(
      (s) => s.ncnAddress !== key
    );
    if (otherSlashings.length >= this.config.contagionThreshold) {
      events.push({
        ncnAddress: key,
        severity: SIGNAL_HIGH,
        reason: `Contagion risk: ${otherSlashings.length} other NCNs slashed in 1h`,
        timestamp: snapshot.timestamp,
        metrics: { otherSlashingCount: otherSlashings.length },
      });
    }

    // --- Direct slashing event ---
    if (snapshot.slashingEvent) {
      events.push({
        ncnAddress: key,
        severity: SIGNAL_CRITICAL,
        reason: "Direct slashing event detected",
        timestamp: snapshot.timestamp,
        metrics: {},
      });
    }

    return events;
  }

  /** Get the maximum severity from a set of events */
  static maxSeverity(events: SignalEvent[]): SignalSeverity {
    if (events.length === 0) return SIGNAL_NONE;
    return Math.max(...events.map((e) => e.severity)) as SignalSeverity;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const detector = new SignalDetector();

  console.log("[SIGNAL-DETECTOR] Starting anomaly detection");

  // Simulate NCN data stream
  const simulate = () => {
    const now = Math.floor(Date.now() / 1000);

    const snapshot: NcnSnapshot = {
      ncnAddress: "mock_ncn_1",
      ncnName: "Pyth Oracle NCN",
      uptimeE6: 995_000 + Math.round((Math.random() - 0.5) * 10_000),
      totalRestakedSol:
        500_000_000_000_000 +
        Math.round((Math.random() - 0.5) * 50_000_000_000_000),
      restakerCount: 1200 + Math.round((Math.random() - 0.5) * 50),
      slashingEvent: Math.random() < 0.005,
      timestamp: now,
    };

    const events = detector.detect(snapshot);
    const severity = SignalDetector.maxSeverity(events);
    const severityNames = ["NONE", "LOW", "HIGH", "CRITICAL"];

    if (events.length > 0) {
      console.log(
        `[SIGNAL-DETECTOR] ${snapshot.ncnName}: severity=${severityNames[severity]}`
      );
      for (const evt of events) {
        console.log(`  - [${severityNames[evt.severity]}] ${evt.reason}`);
      }
    } else {
      console.log(
        `[SIGNAL-DETECTOR] ${snapshot.ncnName}: all clear`
      );
    }
  };

  simulate();
  setInterval(simulate, 10_000);
}

main().catch(console.error);
