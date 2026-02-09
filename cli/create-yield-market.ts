/**
 * Create a restaking yield perp market on Percolator
 *
 * Usage: npx ts-node cli/create-yield-market.ts --ncn <NCN_ADDRESS> --name <NCN_NAME>
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
  buildYieldMatcherInitIx,
} from "../sdk/src/yieldMatcher";
import { YieldMatcherMode } from "../sdk/src/types";

async function main() {
  const args = process.argv.slice(2);
  const ncnIdx = args.indexOf("--ncn");
  const nameIdx = args.indexOf("--name");

  if (ncnIdx === -1 || nameIdx === -1) {
    console.log(
      "Usage: npx ts-node cli/create-yield-market.ts --ncn <NCN_ADDRESS> --name <NCN_NAME>"
    );
    console.log("");
    console.log("Options:");
    console.log("  --ncn      NCN address (Pubkey)");
    console.log("  --name     NCN name for display");
    console.log(
      "  --mode     0=AllNCN, 1=SingleNCN (default: 1)"
    );
    console.log(
      "  --base-spread    Base spread in bps (default: 20)"
    );
    console.log(
      "  --vol-spread     Yield vol spread in bps (default: 30)"
    );
    console.log(
      "  --max-spread     Max spread in bps (default: 200)"
    );
    process.exit(1);
  }

  const ncnAddress = new PublicKey(args[ncnIdx + 1]);
  const ncnName = args[nameIdx + 1];

  const modeIdx = args.indexOf("--mode");
  const mode =
    modeIdx !== -1
      ? parseInt(args[modeIdx + 1])
      : YieldMatcherMode.SingleNCN;

  const baseSpreadIdx = args.indexOf("--base-spread");
  const baseSpread =
    baseSpreadIdx !== -1 ? parseInt(args[baseSpreadIdx + 1]) : 20;

  const volSpreadIdx = args.indexOf("--vol-spread");
  const volSpread =
    volSpreadIdx !== -1 ? parseInt(args[volSpreadIdx + 1]) : 30;

  const maxSpreadIdx = args.indexOf("--max-spread");
  const maxSpread =
    maxSpreadIdx !== -1 ? parseInt(args[maxSpreadIdx + 1]) : 200;

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

  // Derive PDAs for NCN oracle feeds
  const NCN_ORACLE_PROGRAM_ID = new PublicKey(
    "NCNRsk1111111111111111111111111111111111111"
  );
  const [ncnYieldFeed] = PublicKey.findProgramAddressSync(
    [Buffer.from("ncn_yield_feed"), ncnAddress.toBuffer()],
    NCN_ORACLE_PROGRAM_ID
  );
  const [ncnPerformanceFeed] = PublicKey.findProgramAddressSync(
    [Buffer.from("ncn_perf_feed"), ncnAddress.toBuffer()],
    NCN_ORACLE_PROGRAM_ID
  );

  // Create matcher context account
  const matcherContext = Keypair.generate();
  const CTX_SIZE = 320;

  console.log(`\nCreating yield market for: ${ncnName}`);
  console.log(`  NCN: ${ncnAddress.toBase58()}`);
  console.log(
    `  Mode: ${mode === 0 ? "AllNCN" : "SingleNCN"}`
  );
  console.log(
    `  Spreads: base=${baseSpread} vol=${volSpread} max=${maxSpread}`
  );
  console.log(
    `  Context: ${matcherContext.publicKey.toBase58()}`
  );
  console.log(`  Yield Feed: ${ncnYieldFeed.toBase58()}`);
  console.log(
    `  Performance Feed: ${ncnPerformanceFeed.toBase58()}`
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
      "YLDMtch111111111111111111111111111111111111"
    ),
  });

  // Step 2: Initialize matcher
  const initIx = buildYieldMatcherInitIx(
    authority.publicKey,
    matcherContext.publicKey,
    mode,
    baseSpread,
    volSpread,
    maxSpread,
    10, // impact_k_bps
    new BN("1000000000000"), // 1M USDC liquidity
    new BN("100000000000"), // 100K max fill
    ncnYieldFeed,
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
    console.log(`\nYield market created! Tx: ${sig}`);
    console.log(
      `Matcher context: ${matcherContext.publicKey.toBase58()}`
    );
  } catch (err) {
    console.error("Failed to create yield market:", err);
    process.exit(1);
  }
}

main().catch(console.error);
