/**
 * Create an NCN index perp market on Percolator
 *
 * Usage: npm run create-index-market -- --base-spread 20 --vol-spread 30 --max-spread 200
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
import { buildIndexMatcherInitIx } from "../sdk/src/indexMatcher";
import { IndexMatcherMode } from "../sdk/src/types";

async function main() {
  const args = process.argv.slice(2);

  const baseSpreadIdx = args.indexOf("--base-spread");
  const baseSpread = baseSpreadIdx !== -1 ? parseInt(args[baseSpreadIdx + 1]) : 20;

  const volSpreadIdx = args.indexOf("--vol-spread");
  const volSpread = volSpreadIdx !== -1 ? parseInt(args[volSpreadIdx + 1]) : 30;

  const maxSpreadIdx = args.indexOf("--max-spread");
  const maxSpread = maxSpreadIdx !== -1 ? parseInt(args[maxSpreadIdx + 1]) : 200;

  const minNcnIdx = args.indexOf("--min-ncn-count");
  const minNcnCount = minNcnIdx !== -1 ? parseInt(args[minNcnIdx + 1]) : 3;

  const modeIdx = args.indexOf("--mode");
  const mode = modeIdx !== -1 ? parseInt(args[modeIdx + 1]) : IndexMatcherMode.FullIndex;

  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  let authority: Keypair;
  if (process.env.AUTHORITY_KEYPAIR) {
    authority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(process.env.AUTHORITY_KEYPAIR))
    );
  } else {
    authority = Keypair.generate();
    console.log(`Using generated keypair: ${authority.publicKey.toBase58()}`);
  }

  // Derive AggregatedRestakingFeed PDA
  const NCN_ORACLE_PROGRAM_ID = new PublicKey(
    "NCNRsk1111111111111111111111111111111111111"
  );
  const [aggregatedFeed] = PublicKey.findProgramAddressSync(
    [Buffer.from("aggregated_restaking_feed")],
    NCN_ORACLE_PROGRAM_ID
  );

  const matcherContext = Keypair.generate();
  const CTX_SIZE = 320;

  console.log(`\nCreating index market`);
  console.log(`  Mode: ${mode === 0 ? "FullIndex" : "ExclusionIndex"}`);
  console.log(`  Spreads: base=${baseSpread} vol=${volSpread} max=${maxSpread}`);
  console.log(`  Min NCN count: ${minNcnCount}`);
  console.log(`  Context: ${matcherContext.publicKey.toBase58()}`);
  console.log(`  Aggregated Feed: ${aggregatedFeed.toBase58()}`);

  const INDEX_MATCHER_PROGRAM_ID = new PublicKey(
    "IDXMtch111111111111111111111111111111111111"
  );

  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: authority.publicKey,
    newAccountPubkey: matcherContext.publicKey,
    lamports: await connection.getMinimumBalanceForRentExemption(CTX_SIZE),
    space: CTX_SIZE,
    programId: INDEX_MATCHER_PROGRAM_ID,
  });

  const initIx = buildIndexMatcherInitIx(
    authority.publicKey,
    matcherContext.publicKey,
    mode,
    baseSpread,
    volSpread,
    maxSpread,
    10, // impact_k_bps
    minNcnCount,
    new BN("1000000000000"), // 1M USDC liquidity
    new BN("100000000000"),  // 100K max fill
    aggregatedFeed
  );

  const tx = new Transaction().add(createAccountIx, initIx);

  try {
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [authority, matcherContext],
      { commitment: "confirmed" }
    );
    console.log(`\nIndex market created! Tx: ${sig}`);
    console.log(`Matcher context: ${matcherContext.publicKey.toBase58()}`);
  } catch (err) {
    console.error("Failed to create index market:", err);
    process.exit(1);
  }
}

main().catch(console.error);
