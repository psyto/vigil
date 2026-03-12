/**
 * Index Sync — Reads aggregated restaking data and pushes to index-matcher
 *
 * Computes index regime from cross-NCN variance and syncs to the index market.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

// ============================================================================
// Configuration
// ============================================================================

const INDEX_MATCHER_PROGRAM_ID = new PublicKey(
  "IDXMtch111111111111111111111111111111111111"
);

const REGIME_THRESHOLDS = {
  VERY_LOW: 50,
  LOW: 150,
  NORMAL: 400,
  HIGH: 800,
};

// ============================================================================
// Index Regime Classification
// ============================================================================

function classifyIndexRegime(varianceBps: number): number {
  if (varianceBps <= REGIME_THRESHOLDS.VERY_LOW) return 0;
  if (varianceBps <= REGIME_THRESHOLDS.LOW) return 1;
  if (varianceBps <= REGIME_THRESHOLDS.NORMAL) return 2;
  if (varianceBps <= REGIME_THRESHOLDS.HIGH) return 3;
  return 4;
}

// ============================================================================
// Mock Index Data Source (Phase 1)
// ============================================================================

interface IndexSnapshot {
  weightedAvgApyBps: number;
  totalRestakedSol: number;
  ncnCount: number;
  indexVarianceBps: number;
}

class MockIndexSource {
  private lastAvgApy: number;
  private history: number[] = [];

  constructor(
    private baseAvgApy: number = 750,
    private baseNcnCount: number = 5
  ) {
    this.lastAvgApy = baseAvgApy;
  }

  generateSnapshot(): IndexSnapshot {
    // Mean-reverting index yield with noise
    const meanReversion = (this.baseAvgApy - this.lastAvgApy) * 0.03;
    const noise = (Math.random() - 0.5) * 30;
    this.lastAvgApy = Math.max(0, Math.round(this.lastAvgApy + meanReversion + noise));
    this.history.push(this.lastAvgApy);
    if (this.history.length > 168) this.history.shift();

    // Calculate variance from history
    const avg = this.history.reduce((a, b) => a + b, 0) / this.history.length;
    const variance =
      this.history.length > 1
        ? this.history.reduce((sum, v) => sum + (v - avg) ** 2, 0) /
          (this.history.length - 1)
        : 0;
    const varianceBps = Math.round(Math.sqrt(variance));

    // Simulate NCN count fluctuation (rare)
    const ncnCount = this.baseNcnCount + (Math.random() > 0.95 ? -1 : 0);

    return {
      weightedAvgApyBps: this.lastAvgApy,
      totalRestakedSol: Math.round(2_000_000 * 1e9), // 2M SOL
      ncnCount: Math.max(1, ncnCount),
      indexVarianceBps: varianceBps,
    };
  }
}

// ============================================================================
// Instruction Builder — IndexSync (tag 0x03)
// ============================================================================

function buildIndexSyncIx(
  matcherContext: PublicKey,
  aggregatedFeed: PublicKey,
  weightedAvgApyBps: BN,
  indexMarkPriceE6: BN,
  regime: number,
  totalRestakedSol: BN,
  ncnCount: number
): TransactionInstruction {
  const data = Buffer.alloc(30);
  data.writeUInt8(0x03, 0);
  weightedAvgApyBps.toBuffer("le", 8).copy(data, 1);
  indexMarkPriceE6.toBuffer("le", 8).copy(data, 9);
  data.writeUInt8(regime, 17);
  totalRestakedSol.toBuffer("le", 8).copy(data, 18);
  data.writeUInt32LE(ncnCount, 26);

  return new TransactionInstruction({
    programId: INDEX_MATCHER_PROGRAM_ID,
    keys: [
      { pubkey: matcherContext, isSigner: false, isWritable: true },
      { pubkey: aggregatedFeed, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ============================================================================
// Sync Loop
// ============================================================================

async function runIndexSync(
  connection: Connection,
  authority: Keypair,
  matcherContext: PublicKey,
  aggregatedFeed: PublicKey,
  intervalMs: number = 30_000
) {
  const indexSource = new MockIndexSource();
  const regimeNames = ["VeryLow", "Low", "Normal", "High", "Extreme"];

  console.log("[INDEX-SYNC] Starting index sync");
  console.log(`[INDEX-SYNC] Polling interval: ${intervalMs / 1000}s`);

  const tick = async () => {
    try {
      const snapshot = indexSource.generateSnapshot();
      const regime = classifyIndexRegime(snapshot.indexVarianceBps);
      const indexMarkPriceE6 = snapshot.weightedAvgApyBps * 1_000_000;

      console.log(
        `[INDEX-SYNC] Avg APY=${(snapshot.weightedAvgApyBps / 100).toFixed(2)}%  ncn_count=${snapshot.ncnCount}  variance=${snapshot.indexVarianceBps}bps  regime=${regimeNames[regime]}`
      );
    } catch (err) {
      console.error("[INDEX-SYNC] Error:", err);
    }
  };

  await tick();
  setInterval(tick, intervalMs);
}

export {
  MockIndexSource,
  classifyIndexRegime,
  buildIndexSyncIx,
  runIndexSync,
};
export type { IndexSnapshot };
