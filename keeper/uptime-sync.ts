/**
 * Uptime Sync — Reads NCN uptime probability from ncn-monitor data
 * and pushes to ncn-uptime-matcher via UptimeSync instruction (0x03)
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

const UPTIME_MATCHER_PROGRAM_ID = new PublicKey(
  "UPTMtch111111111111111111111111111111111111"
);

// Signal severity levels (Kalshify-style)
const SIGNAL_NONE = 0;
const SIGNAL_LOW = 1;
const SIGNAL_HIGH = 2;
const SIGNAL_CRITICAL = 3;

// Signal-based spread additions (in bps)
const SIGNAL_SPREAD_MAP: Record<number, number> = {
  [SIGNAL_NONE]: 0,
  [SIGNAL_LOW]: 25,
  [SIGNAL_HIGH]: 100,
  [SIGNAL_CRITICAL]: 300,
};

// ============================================================================
// Instruction Builder — UptimeSync (tag 0x03)
// ============================================================================

function buildUptimeSyncIx(
  matcherContext: PublicKey,
  ncnOracle: PublicKey,
  newUptimeE6: BN,
  signalSeverity: BN,
  signalAdjustedSpread: BN
): TransactionInstruction {
  // Data layout:
  //   [0]    tag (0x03)
  //   [1..9] new_uptime_e6 (u64 LE, 0-1_000_000)
  //   [9..17] signal_severity (u64 LE, 0-3)
  //   [17..25] signal_adjusted_spread (u64 LE)
  const data = Buffer.alloc(25);
  data.writeUInt8(0x03, 0);
  newUptimeE6.toBuffer("le", 8).copy(data, 1);
  signalSeverity.toBuffer("le", 8).copy(data, 9);
  signalAdjustedSpread.toBuffer("le", 8).copy(data, 17);

  return new TransactionInstruction({
    programId: UPTIME_MATCHER_PROGRAM_ID,
    keys: [
      {
        pubkey: matcherContext,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: ncnOracle, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ============================================================================
// Sync Loop
// ============================================================================

interface UptimeData {
  uptimeE6: number;
  signalSeverity: number;
}

async function runUptimeSync(
  connection: Connection,
  authority: Keypair,
  matcherContext: PublicKey,
  ncnOracle: PublicKey,
  getUptimeData: () => UptimeData,
  intervalMs: number = 30_000
) {
  console.log("[UPTIME-SYNC] Starting uptime sync");
  console.log(
    `[UPTIME-SYNC] Polling interval: ${intervalMs / 1000}s`
  );

  const tick = async () => {
    try {
      const data = getUptimeData();
      const signalSpread =
        SIGNAL_SPREAD_MAP[data.signalSeverity] ?? 0;

      const severityNames = ["NONE", "LOW", "HIGH", "CRITICAL"];
      console.log(
        `[UPTIME-SYNC] uptime=${(data.uptimeE6 / 10_000).toFixed(2)}% signal=${severityNames[data.signalSeverity]} spread_adj=${signalSpread}bps`
      );

      // In production: build and send transaction
      // const ix = buildUptimeSyncIx(
      //   matcherContext, ncnOracle,
      //   new BN(data.uptimeE6),
      //   new BN(data.signalSeverity),
      //   new BN(signalSpread)
      // );
      // const tx = new Transaction().add(ix);
      // await connection.sendTransaction(tx, [authority]);
    } catch (err) {
      console.error("[UPTIME-SYNC] Error:", err);
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
      `[UPTIME-SYNC] Using generated keypair: ${authority.publicKey.toBase58()}`
    );
  }

  const matcherContext = PublicKey.unique();
  const ncnOracle = PublicKey.unique();

  // Mock uptime data source — in production, reads from NCN monitor
  let currentUptime = 995_000; // 99.5%
  let currentSignal = SIGNAL_NONE;

  const getUptimeData = (): UptimeData => {
    // Simulate small fluctuations
    const noise = Math.round((Math.random() - 0.5) * 2_000);
    currentUptime = Math.max(
      0,
      Math.min(1_000_000, currentUptime + noise)
    );

    // Occasionally simulate signal events
    if (Math.random() < 0.02) {
      currentSignal = SIGNAL_LOW;
    } else if (Math.random() < 0.005) {
      currentSignal = SIGNAL_HIGH;
    } else if (Math.random() < 0.001) {
      currentSignal = SIGNAL_CRITICAL;
    } else {
      currentSignal = SIGNAL_NONE;
    }

    return {
      uptimeE6: currentUptime,
      signalSeverity: currentSignal,
    };
  };

  const intervalMs = parseInt(
    process.env.POLL_INTERVAL_MS ?? "30000",
    10
  );

  await runUptimeSync(
    connection,
    authority,
    matcherContext,
    ncnOracle,
    getUptimeData,
    intervalMs
  );
}

export {
  buildUptimeSyncIx,
  runUptimeSync,
  UptimeData,
  SIGNAL_NONE,
  SIGNAL_LOW,
  SIGNAL_HIGH,
  SIGNAL_CRITICAL,
  SIGNAL_SPREAD_MAP,
};

// Run when executed directly
if (process.argv[1]?.replace(/\.(js|ts)$/, '').endsWith('uptime-sync')) {
  main().catch(console.error);
}
