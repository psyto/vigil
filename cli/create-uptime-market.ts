/**
 * Create an NCN uptime perp market on Percolator
 *
 * Usage: npx ts-node cli/create-uptime-market.ts --ncn <NCN_ADDRESS> --name <NCN_NAME>
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  buildUptimeMatcherInitIx,
} from "../sdk/src/uptimeMatcher";
import { UptimeMatcherMode } from "../sdk/src/types";

async function main() {
  const args = process.argv.slice(2);
  const ncnIdx = args.indexOf("--ncn");
  const nameIdx = args.indexOf("--name");

  if (ncnIdx === -1 || nameIdx === -1) {
    console.log(
      "Usage: npx ts-node cli/create-uptime-market.ts --ncn <NCN_ADDRESS> --name <NCN_NAME>"
    );
    console.log("");
    console.log("Options:");
    console.log("  --ncn            NCN address (Pubkey)");
    console.log("  --name           NCN name for display");
    console.log(
      "  --mode           0=Continuous, 1=SlashingSettlement (default: 0)"
    );
    console.log(
      "  --base-spread    Base spread in bps (default: 20)"
    );
    console.log(
      "  --edge-spread    Edge spread in bps (default: 30)"
    );
    console.log(
      "  --max-spread     Max spread in bps (default: 500)"
    );
    console.log(
      "  --uptime         Initial uptime e6 (default: 995000 = 99.5%)"
    );
    console.log(
      "  --resolution-ts  Resolution timestamp (default: 0 = no expiry)"
    );
    process.exit(1);
  }

  const ncnAddress = new PublicKey(args[ncnIdx + 1]);
  const ncnName = args[nameIdx + 1];

  const modeIdx = args.indexOf("--mode");
  const mode =
    modeIdx !== -1
      ? parseInt(args[modeIdx + 1])
      : UptimeMatcherMode.Continuous;

  const baseSpreadIdx = args.indexOf("--base-spread");
  const baseSpread =
    baseSpreadIdx !== -1 ? parseInt(args[baseSpreadIdx + 1]) : 20;

  const edgeSpreadIdx = args.indexOf("--edge-spread");
  const edgeSpread =
    edgeSpreadIdx !== -1 ? parseInt(args[edgeSpreadIdx + 1]) : 30;

  const maxSpreadIdx = args.indexOf("--max-spread");
  const maxSpread =
    maxSpreadIdx !== -1 ? parseInt(args[maxSpreadIdx + 1]) : 500;

  const uptimeIdx = args.indexOf("--uptime");
  const initialUptime =
    uptimeIdx !== -1 ? parseInt(args[uptimeIdx + 1]) : 995_000;

  const resIdx = args.indexOf("--resolution-ts");
  const resolutionTs =
    resIdx !== -1 ? parseInt(args[resIdx + 1]) : 0;

  const rpcUrl =
    process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  let authority: Keypair;
  if (process.env.AUTHORITY_KEYPAIR) {
    authority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(process.env.AUTHORITY_KEYPAIR))
    );
  } else {
    authority = Keypair.generate();
    console.log(
      `Using generated keypair: ${authority.publicKey.toBase58()}`
    );
  }

  // Derive NCN oracle PDA
  const NCN_ORACLE_PROGRAM_ID = new PublicKey(
    "NCNRsk1111111111111111111111111111111111111"
  );
  const [ncnPerformanceFeed] = PublicKey.findProgramAddressSync(
    [Buffer.from("ncn_perf_feed"), ncnAddress.toBuffer()],
    NCN_ORACLE_PROGRAM_ID
  );

  const matcherContext = Keypair.generate();
  const CTX_SIZE = 320;

  console.log(`\nCreating uptime market for: ${ncnName}`);
  console.log(`  NCN: ${ncnAddress.toBase58()}`);
  console.log(
    `  Mode: ${mode === 0 ? "Continuous" : "SlashingSettlement"}`
  );
  console.log(
    `  Spreads: base=${baseSpread} edge=${edgeSpread} max=${maxSpread}`
  );
  console.log(
    `  Initial uptime: ${(initialUptime / 10_000).toFixed(2)}%`
  );
  console.log(
    `  Resolution: ${resolutionTs === 0 ? "none" : new Date(resolutionTs * 1000).toISOString()}`
  );
  console.log(
    `  Context: ${matcherContext.publicKey.toBase58()}`
  );
  console.log(
    `  NCN Oracle: ${ncnPerformanceFeed.toBase58()}`
  );

  // Step 1: Create context account
  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: authority.publicKey,
    newAccountPubkey: matcherContext.publicKey,
    lamports: await connection.getMinimumBalanceForRentExemption(
      CTX_SIZE
    ),
    space: CTX_SIZE,
    programId: new PublicKey(
      "UPTMtch111111111111111111111111111111111111"
    ),
  });

  // Step 2: Initialize matcher
  const initIx = buildUptimeMatcherInitIx(
    authority.publicKey,
    matcherContext.publicKey,
    mode,
    baseSpread,
    edgeSpread,
    maxSpread,
    10, // impact_k_bps
    new BN(initialUptime),
    new BN(resolutionTs),
    new BN("1000000000000"), // 1M USDC liquidity
    new BN("100000000000"), // 100K max fill
    ncnPerformanceFeed
  );

  const tx = new Transaction().add(createAccountIx, initIx);

  try {
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [authority, matcherContext],
      { commitment: "confirmed" }
    );
    console.log(`\nUptime market created! Tx: ${sig}`);
    console.log(
      `Matcher context: ${matcherContext.publicKey.toBase58()}`
    );
  } catch (err) {
    console.error("Failed to create uptime market:", err);
    process.exit(1);
  }
}

main().catch(console.error);
