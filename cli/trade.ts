/**
 * Trade — Long/short yield or uptime via matcher
 *
 * Usage: npm run trade -- --type <yield|uptime> --context <CONTEXT_PUBKEY> --side <long|short>
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  buildYieldMatcherMatchIx,
  fetchYieldMatcherContext,
  simulateYieldExecPrice,
} from "../sdk/src/yieldMatcher";
import {
  buildUptimeMatcherMatchIx,
  fetchUptimeMatcherContext,
  simulateUptimeExecPrice,
} from "../sdk/src/uptimeMatcher";

const YIELD_REGIME_NAMES = [
  "VeryLow",
  "Low",
  "Normal",
  "High",
  "Extreme",
];

async function main() {
  const args = process.argv.slice(2);
  const typeIdx = args.indexOf("--type");
  const ctxIdx = args.indexOf("--context");
  const sideIdx = args.indexOf("--side");

  if (typeIdx === -1 || ctxIdx === -1 || sideIdx === -1) {
    console.log(
      "Usage: npm run trade -- --type <yield|uptime> --context <CONTEXT_PUBKEY> --side <long|short>"
    );
    process.exit(1);
  }

  const marketType = args[typeIdx + 1];
  const contextPubkey = new PublicKey(args[ctxIdx + 1]);
  const side = args[sideIdx + 1];

  if (
    marketType !== "yield" &&
    marketType !== "uptime"
  ) {
    console.error("Market type must be 'yield' or 'uptime'");
    process.exit(1);
  }
  if (side !== "long" && side !== "short") {
    console.error("Side must be 'long' or 'short'");
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
  }

  console.log(
    `\nTrading ${side.toUpperCase()} on ${marketType} market`
  );
  console.log(`  Context: ${contextPubkey.toBase58()}`);

  if (marketType === "yield") {
    const ctx = await fetchYieldMatcherContext(
      connection,
      contextPubkey
    );
    if (!ctx) {
      console.error("Could not fetch yield matcher context");
      process.exit(1);
    }

    const simPrice = simulateYieldExecPrice(ctx);
    console.log(
      `  Current yield: ${Number(ctx.currentYieldBps) / 100}%`
    );
    console.log(
      `  Mark price: ${ctx.yieldMarkPriceE6}`
    );
    console.log(
      `  Regime: ${YIELD_REGIME_NAMES[ctx.yieldRegime]}`
    );
    console.log(
      `  Simulated exec price: ${simPrice}`
    );

    const ix = buildYieldMatcherMatchIx(
      authority.publicKey,
      contextPubkey
    );
    const tx = new Transaction().add(ix);

    try {
      const sig = await sendAndConfirmTransaction(
        connection,
        tx,
        [authority],
        { commitment: "confirmed" }
      );
      console.log(`\nTrade executed! Tx: ${sig}`);
    } catch (err) {
      console.error("Trade failed:", err);
      process.exit(1);
    }
  } else {
    const ctx = await fetchUptimeMatcherContext(
      connection,
      contextPubkey
    );
    if (!ctx) {
      console.error("Could not fetch uptime matcher context");
      process.exit(1);
    }

    if (ctx.isResolved) {
      console.error("Market is resolved — no more trading");
      process.exit(1);
    }

    const simPrice = simulateUptimeExecPrice(ctx);
    console.log(
      `  Current uptime: ${(Number(ctx.currentUptimeE6) / 10_000).toFixed(2)}%`
    );
    console.log(
      `  Mark price: ${ctx.uptimeMarkE6}`
    );
    console.log(
      `  Signal severity: ${ctx.signalSeverity}`
    );
    console.log(
      `  Simulated exec price: ${simPrice}`
    );

    const ix = buildUptimeMatcherMatchIx(
      authority.publicKey,
      contextPubkey
    );
    const tx = new Transaction().add(ix);

    try {
      const sig = await sendAndConfirmTransaction(
        connection,
        tx,
        [authority],
        { commitment: "confirmed" }
      );
      console.log(`\nTrade executed! Tx: ${sig}`);
    } catch (err) {
      console.error("Trade failed:", err);
      process.exit(1);
    }
  }
}

main().catch(console.error);
