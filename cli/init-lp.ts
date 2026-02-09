/**
 * Initialize LP with matcher — creates context account and initializes it
 *
 * Usage: npx ts-node cli/init-lp.ts --type <yield|uptime> --ncn <NCN_ADDRESS>
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
import { buildYieldMatcherInitIx } from "../sdk/src/yieldMatcher";
import { buildUptimeMatcherInitIx } from "../sdk/src/uptimeMatcher";
import {
  YieldMatcherMode,
  UptimeMatcherMode,
} from "../sdk/src/types";

async function main() {
  const args = process.argv.slice(2);
  const typeIdx = args.indexOf("--type");

  if (typeIdx === -1) {
    console.log(
      "Usage: npx ts-node cli/init-lp.ts --type <yield|uptime> [options]"
    );
    console.log("");
    console.log("Options:");
    console.log(
      "  --type       Market type: yield or uptime"
    );
    console.log("  --ncn        NCN address (Pubkey)");
    console.log(
      "  --liquidity  Liquidity in USDC (default: 1000000)"
    );
    console.log(
      "  --max-fill   Max fill in USDC (default: 100000)"
    );
    process.exit(1);
  }

  const marketType = args[typeIdx + 1];
  if (marketType !== "yield" && marketType !== "uptime") {
    console.error("Market type must be 'yield' or 'uptime'");
    process.exit(1);
  }

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

  const ncnIdx = args.indexOf("--ncn");
  const ncnAddress =
    ncnIdx !== -1
      ? new PublicKey(args[ncnIdx + 1])
      : PublicKey.unique();

  const liqIdx = args.indexOf("--liquidity");
  const liquidity =
    liqIdx !== -1
      ? parseInt(args[liqIdx + 1])
      : 1_000_000;

  const fillIdx = args.indexOf("--max-fill");
  const maxFill =
    fillIdx !== -1 ? parseInt(args[fillIdx + 1]) : 100_000;

  const matcherContext = Keypair.generate();
  const CTX_SIZE = 320;

  const NCN_ORACLE_PROGRAM_ID = new PublicKey(
    "NCNRsk1111111111111111111111111111111111111"
  );

  const programId =
    marketType === "yield"
      ? new PublicKey(
          "YLDMtch111111111111111111111111111111111111"
        )
      : new PublicKey(
          "UPTMtch111111111111111111111111111111111111"
        );

  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: authority.publicKey,
    newAccountPubkey: matcherContext.publicKey,
    lamports: await connection.getMinimumBalanceForRentExemption(
      CTX_SIZE
    ),
    space: CTX_SIZE,
    programId,
  });

  let initIx;
  if (marketType === "yield") {
    const [ncnYieldFeed] = PublicKey.findProgramAddressSync(
      [Buffer.from("ncn_yield_feed"), ncnAddress.toBuffer()],
      NCN_ORACLE_PROGRAM_ID
    );
    const [ncnPerformanceFeed] = PublicKey.findProgramAddressSync(
      [Buffer.from("ncn_perf_feed"), ncnAddress.toBuffer()],
      NCN_ORACLE_PROGRAM_ID
    );

    initIx = buildYieldMatcherInitIx(
      authority.publicKey,
      matcherContext.publicKey,
      YieldMatcherMode.SingleNCN,
      20, // base spread
      30, // yield vol spread
      200, // max spread
      10, // impact_k
      new BN(liquidity * 1_000_000),
      new BN(maxFill * 1_000_000),
      ncnYieldFeed,
      ncnPerformanceFeed
    );
  } else {
    const [ncnPerformanceFeed] = PublicKey.findProgramAddressSync(
      [Buffer.from("ncn_perf_feed"), ncnAddress.toBuffer()],
      NCN_ORACLE_PROGRAM_ID
    );

    initIx = buildUptimeMatcherInitIx(
      authority.publicKey,
      matcherContext.publicKey,
      UptimeMatcherMode.Continuous,
      20, // base spread
      30, // edge spread
      500, // max spread
      10, // impact_k
      new BN(995_000), // 99.5% initial uptime
      new BN(0), // no expiry
      new BN(liquidity * 1_000_000),
      new BN(maxFill * 1_000_000),
      ncnPerformanceFeed
    );
  }

  console.log(`\nInitializing LP for ${marketType} market`);
  console.log(
    `  Context: ${matcherContext.publicKey.toBase58()}`
  );
  console.log(`  NCN: ${ncnAddress.toBase58()}`);
  console.log(`  Liquidity: ${liquidity} USDC`);
  console.log(`  Max fill: ${maxFill} USDC`);

  const tx = new Transaction().add(createAccountIx, initIx);

  try {
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [authority, matcherContext],
      { commitment: "confirmed" }
    );
    console.log(`\nLP initialized! Tx: ${sig}`);
    console.log(
      `Matcher context: ${matcherContext.publicKey.toBase58()}`
    );
  } catch (err) {
    console.error("Failed to initialize LP:", err);
    process.exit(1);
  }
}

main().catch(console.error);
