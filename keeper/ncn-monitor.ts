/**
 * NCN Monitor — Reads Fragmetric/Jito NCN data and pushes to NcnPerformanceFeed
 *
 * Phase 1 (mock): Generates realistic simulated NCN data for devnet testing
 * Phase 2 (real): Polls Fragmetric API / Jito TipRouter for actual NCN performance data
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";

// ============================================================================
// Configuration
// ============================================================================

const NCN_ORACLE_PROGRAM_ID = new PublicKey(
  "NCNRsk1111111111111111111111111111111111111"
);

interface NcnConfig {
  name: string;
  ncnAddress: PublicKey;
  baseUptime: number; // e6 scale (995000 = 99.5%)
  uptimeVolatility: number; // standard deviation in e6 units
  slashingProbability: number; // per-epoch probability (e.g., 0.001 = 0.1%)
  baseRestakedSol: number; // in lamports
  baseRestakerCount: number;
}

// ============================================================================
// Mock NCN Data Generator (Phase 1)
// ============================================================================

class MockNcnDataSource {
  private configs: NcnConfig[];
  private lastUptime: Map<string, number> = new Map();

  constructor(configs: NcnConfig[]) {
    this.configs = configs;
    for (const c of configs) {
      this.lastUptime.set(c.ncnAddress.toBase58(), c.baseUptime);
    }
  }

  /** Generate realistic simulated NCN data with mean-reverting uptime */
  generateSample(ncnAddress: PublicKey): {
    uptimeE6: number;
    totalRestakedSol: number;
    restakerCount: number;
    slashingEvent: boolean;
  } {
    const key = ncnAddress.toBase58();
    const config = this.configs.find(
      (c) => c.ncnAddress.toBase58() === key
    );
    if (!config) throw new Error(`Unknown NCN: ${key}`);

    const lastUptime = this.lastUptime.get(key) ?? config.baseUptime;

    // Mean-reverting uptime with noise
    const meanReversion = (config.baseUptime - lastUptime) * 0.1;
    const noise =
      (Math.random() - 0.5) * 2 * config.uptimeVolatility;
    let newUptime = Math.round(lastUptime + meanReversion + noise);
    newUptime = Math.max(0, Math.min(1_000_000, newUptime));

    // Random slashing event
    const slashingEvent = Math.random() < config.slashingProbability;
    if (slashingEvent) {
      // Uptime drops significantly on slashing
      newUptime = Math.max(0, newUptime - 50_000); // -5%
    }

    this.lastUptime.set(key, newUptime);

    // TVL fluctuation (+/- 5%)
    const tvlNoise = 1 + (Math.random() - 0.5) * 0.1;
    const totalRestakedSol = Math.round(
      config.baseRestakedSol * tvlNoise
    );

    // Restaker count fluctuation
    const restakerNoise = Math.round((Math.random() - 0.5) * 10);
    const restakerCount = Math.max(
      1,
      config.baseRestakerCount + restakerNoise
    );

    return {
      uptimeE6: newUptime,
      totalRestakedSol,
      restakerCount,
      slashingEvent,
    };
  }
}

// ============================================================================
// Instruction Builder
// ============================================================================

function buildRecordNcnPerformanceIx(
  authority: PublicKey,
  ncnPerformanceFeed: PublicKey,
  uptimeE6: BN,
  totalRestakedSol: BN,
  restakerCount: number,
  slashingEvent: boolean
): TransactionInstruction {
  // Anchor instruction discriminator for record_ncn_performance
  const discriminator = anchor.utils.bytes.utf8.encode(
    "record_ncn_performance"
  );

  // Build data buffer (simplified — real impl uses Anchor IDL encoding)
  const data = Buffer.alloc(8 + 8 + 8 + 4 + 1);
  // Anchor discriminator (first 8 bytes) would be computed from sighash
  data.writeBigUInt64LE(BigInt("0x" + Buffer.from(
    anchor.utils.sha256.hash("global:record_ncn_performance")
  ).subarray(0, 8).toString("hex")), 0);
  uptimeE6.toBuffer("le", 8).copy(data, 8);
  totalRestakedSol.toBuffer("le", 8).copy(data, 16);
  data.writeUInt32LE(restakerCount, 24);
  data.writeUInt8(slashingEvent ? 1 : 0, 28);

  return new TransactionInstruction({
    programId: NCN_ORACLE_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: ncnPerformanceFeed, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ============================================================================
// Monitor Loop
// ============================================================================

const DEFAULT_NCNS: NcnConfig[] = [
  {
    name: "Pyth Oracle NCN",
    ncnAddress: PublicKey.unique(),
    baseUptime: 998_000, // 99.8%
    uptimeVolatility: 1_000,
    slashingProbability: 0.0005,
    baseRestakedSol: 500_000_000_000_000, // 500k SOL
    baseRestakerCount: 1200,
  },
  {
    name: "Wormhole Bridge NCN",
    ncnAddress: PublicKey.unique(),
    baseUptime: 995_000, // 99.5%
    uptimeVolatility: 2_000,
    slashingProbability: 0.001,
    baseRestakedSol: 300_000_000_000_000, // 300k SOL
    baseRestakerCount: 800,
  },
  {
    name: "Jito MEV NCN",
    ncnAddress: PublicKey.unique(),
    baseUptime: 999_000, // 99.9%
    uptimeVolatility: 500,
    slashingProbability: 0.0002,
    baseRestakedSol: 1_000_000_000_000_000, // 1M SOL
    baseRestakerCount: 3500,
  },
];

async function runMonitor(
  connection: Connection,
  authority: Keypair,
  ncnConfigs: NcnConfig[] = DEFAULT_NCNS,
  intervalMs: number = 60_000
) {
  const dataSource = new MockNcnDataSource(ncnConfigs);

  console.log(
    `[NCN-MONITOR] Starting monitor for ${ncnConfigs.length} NCNs`
  );
  console.log(
    `[NCN-MONITOR] Polling interval: ${intervalMs / 1000}s`
  );

  const tick = async () => {
    for (const config of ncnConfigs) {
      try {
        const sample = dataSource.generateSample(config.ncnAddress);

        console.log(
          `[NCN-MONITOR] ${config.name}: uptime=${(sample.uptimeE6 / 10_000).toFixed(2)}% tvl=${(sample.totalRestakedSol / 1e9).toFixed(0)} SOL restakers=${sample.restakerCount}${sample.slashingEvent ? " *** SLASHING EVENT ***" : ""}`
        );

        // In production: build and send transaction
        // const ix = buildRecordNcnPerformanceIx(...)
        // const tx = new Transaction().add(ix);
        // await connection.sendTransaction(tx, [authority]);
      } catch (err) {
        console.error(
          `[NCN-MONITOR] Error polling ${config.name}:`,
          err
        );
      }
    }
  };

  // Initial tick
  await tick();

  // Schedule recurring
  setInterval(tick, intervalMs);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const rpcUrl =
    process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  // Load authority keypair (from env or default)
  let authority: Keypair;
  if (process.env.AUTHORITY_KEYPAIR) {
    const secretKey = JSON.parse(process.env.AUTHORITY_KEYPAIR);
    authority = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } else {
    authority = Keypair.generate();
    console.log(
      `[NCN-MONITOR] Using generated keypair: ${authority.publicKey.toBase58()}`
    );
  }

  const intervalMs = parseInt(
    process.env.POLL_INTERVAL_MS ?? "60000",
    10
  );

  await runMonitor(connection, authority, DEFAULT_NCNS, intervalMs);
}

/**
 * NcnDataSource interface — abstracts mock vs real data sources.
 * Phase 1 uses MockNcnDataSource, Phase 2 uses FragmetricClient.
 */
export interface NcnDataSource {
  generateSample(ncnAddress: PublicKey): {
    uptimeE6: number;
    totalRestakedSol: number;
    restakerCount: number;
    slashingEvent: boolean;
  } | Promise<{
    uptimeE6: number;
    totalRestakedSol: number;
    restakerCount: number;
    slashingEvent: boolean;
  }>;
}

export { MockNcnDataSource, runMonitor, DEFAULT_NCNS, main as runMonitorMain };
export type { NcnConfig };

// Run when executed directly
if (process.argv[1]?.replace(/\.(js|ts)$/, '').endsWith('ncn-monitor')) {
  main().catch(console.error);
}
