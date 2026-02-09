/**
 * Yield Sync — Reads current restaking APY from NCN oracle and pushes
 * to restaking-yield-matcher via OracleSync instruction (0x03)
 *
 * Decomposes yield into: base staking + MEV + restaking premium
 * Computes yield regime (VeryLow-Extreme) based on historical variance
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

// ============================================================================
// Configuration
// ============================================================================

const YIELD_MATCHER_PROGRAM_ID = new PublicKey(
  "YLDMtch111111111111111111111111111111111111"
);

// Yield regime thresholds (variance in bps)
const REGIME_THRESHOLDS = {
  VERY_LOW: 50,
  LOW: 150,
  NORMAL: 400,
  HIGH: 800,
};

// ============================================================================
// Yield Regime Classification
// ============================================================================

function classifyYieldRegime(varianceBps: number): number {
  if (varianceBps <= REGIME_THRESHOLDS.VERY_LOW) return 0; // VeryLow
  if (varianceBps <= REGIME_THRESHOLDS.LOW) return 1; // Low
  if (varianceBps <= REGIME_THRESHOLDS.NORMAL) return 2; // Normal
  if (varianceBps <= REGIME_THRESHOLDS.HIGH) return 3; // High
  return 4; // Extreme
}

// ============================================================================
// Mock Yield Data Source (Phase 1)
// ============================================================================

interface YieldSnapshot {
  currentApyBps: number;
  baseStakingApyBps: number;
  mevApyBps: number;
  restakingPremiumBps: number;
  yieldVarianceBps: number;
  yield7dAvgBps: number;
  yield30dAvgBps: number;
}

class MockYieldSource {
  private lastApy: number;
  private history: number[] = [];

  constructor(private baseApy: number = 800) {
    // 8% base APY
    this.lastApy = baseApy;
  }

  generateSnapshot(): YieldSnapshot {
    // Mean-reverting yield with noise
    const meanReversion = (this.baseApy - this.lastApy) * 0.05;
    const noise = (Math.random() - 0.5) * 40; // +/- 20 bps noise
    this.lastApy = Math.max(
      0,
      Math.round(this.lastApy + meanReversion + noise)
    );
    this.history.push(this.lastApy);
    if (this.history.length > 168) this.history.shift();

    // Decompose yield
    const baseStaking = Math.round(this.lastApy * 0.55); // ~55% from base staking
    const mev = Math.round(this.lastApy * 0.2); // ~20% from MEV
    const restakingPremium = this.lastApy - baseStaking - mev; // remainder from restaking

    // Calculate variance from history
    const avg =
      this.history.reduce((a, b) => a + b, 0) / this.history.length;
    const variance =
      this.history.length > 1
        ? this.history.reduce(
            (sum, v) => sum + (v - avg) ** 2,
            0
          ) /
          (this.history.length - 1)
        : 0;
    const varianceBps = Math.round(Math.sqrt(variance));

    // 7d and 30d averages
    const last7d = this.history.slice(-168);
    const avg7d = Math.round(
      last7d.reduce((a, b) => a + b, 0) / last7d.length
    );
    const avg30d = Math.round(
      this.history.reduce((a, b) => a + b, 0) / this.history.length
    );

    return {
      currentApyBps: this.lastApy,
      baseStakingApyBps: baseStaking,
      mevApyBps: mev,
      restakingPremiumBps: restakingPremium,
      yieldVarianceBps: varianceBps,
      yield7dAvgBps: avg7d,
      yield30dAvgBps: avg30d,
    };
  }
}

// ============================================================================
// Instruction Builder — OracleSync (tag 0x03)
// ============================================================================

function buildOracleSyncIx(
  matcherContext: PublicKey,
  ncnYieldFeed: PublicKey,
  ncnPerformanceFeed: PublicKey,
  currentYieldBps: BN,
  yieldMarkPriceE6: BN,
  regime: number,
  yield7dAvgBps: BN,
  yield30dAvgBps: BN
): TransactionInstruction {
  // Data layout:
  //   [0]    tag (0x03)
  //   [1..9] current_yield_bps (u64 LE)
  //   [9..17] yield_mark_price_e6 (u64 LE)
  //   [17]   regime (u8)
  //   [18..26] yield_7d_avg_bps (u64 LE)
  //   [26..34] yield_30d_avg_bps (u64 LE)
  const data = Buffer.alloc(34);
  data.writeUInt8(0x03, 0);
  currentYieldBps.toBuffer("le", 8).copy(data, 1);
  yieldMarkPriceE6.toBuffer("le", 8).copy(data, 9);
  data.writeUInt8(regime, 17);
  yield7dAvgBps.toBuffer("le", 8).copy(data, 18);
  yield30dAvgBps.toBuffer("le", 8).copy(data, 26);

  return new TransactionInstruction({
    programId: YIELD_MATCHER_PROGRAM_ID,
    keys: [
      {
        pubkey: matcherContext,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: ncnYieldFeed,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: ncnPerformanceFeed,
        isSigner: false,
        isWritable: false,
      },
    ],
    data,
  });
}

// ============================================================================
// Sync Loop
// ============================================================================

async function runYieldSync(
  connection: Connection,
  authority: Keypair,
  matcherContext: PublicKey,
  ncnYieldFeed: PublicKey,
  ncnPerformanceFeed: PublicKey,
  intervalMs: number = 30_000
) {
  const yieldSource = new MockYieldSource();

  console.log("[YIELD-SYNC] Starting yield sync");
  console.log(`[YIELD-SYNC] Polling interval: ${intervalMs / 1000}s`);

  const tick = async () => {
    try {
      const snapshot = yieldSource.generateSnapshot();
      const regime = classifyYieldRegime(snapshot.yieldVarianceBps);
      const regimeNames = [
        "VeryLow",
        "Low",
        "Normal",
        "High",
        "Extreme",
      ];

      // Mark price = yield in bps * 1e6 (for matcher pricing scale)
      const yieldMarkPriceE6 = snapshot.currentApyBps * 1_000_000;

      console.log(
        `[YIELD-SYNC] APY=${(snapshot.currentApyBps / 100).toFixed(2)}% (base=${(snapshot.baseStakingApyBps / 100).toFixed(2)}% mev=${(snapshot.mevApyBps / 100).toFixed(2)}% restaking=${(snapshot.restakingPremiumBps / 100).toFixed(2)}%) variance=${snapshot.yieldVarianceBps}bps regime=${regimeNames[regime]}`
      );

      // In production: build and send transaction
      // const ix = buildOracleSyncIx(
      //   matcherContext, ncnYieldFeed, ncnPerformanceFeed,
      //   new BN(snapshot.currentApyBps), new BN(yieldMarkPriceE6),
      //   regime, new BN(snapshot.yield7dAvgBps), new BN(snapshot.yield30dAvgBps)
      // );
      // const tx = new Transaction().add(ix);
      // await connection.sendTransaction(tx, [authority]);
    } catch (err) {
      console.error("[YIELD-SYNC] Error:", err);
    }
  };

  await tick();
  setInterval(tick, intervalMs);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const rpcUrl =
    process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  let authority: Keypair;
  if (process.env.AUTHORITY_KEYPAIR) {
    const secretKey = JSON.parse(process.env.AUTHORITY_KEYPAIR);
    authority = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } else {
    authority = Keypair.generate();
    console.log(
      `[YIELD-SYNC] Using generated keypair: ${authority.publicKey.toBase58()}`
    );
  }

  // These would be real account addresses in production
  const matcherContext = PublicKey.unique();
  const ncnYieldFeed = PublicKey.unique();
  const ncnPerformanceFeed = PublicKey.unique();

  const intervalMs = parseInt(
    process.env.POLL_INTERVAL_MS ?? "30000",
    10
  );

  await runYieldSync(
    connection,
    authority,
    matcherContext,
    ncnYieldFeed,
    ncnPerformanceFeed,
    intervalMs
  );
}

main().catch(console.error);

export {
  MockYieldSource,
  YieldSnapshot,
  classifyYieldRegime,
  buildOracleSyncIx,
  runYieldSync,
};
