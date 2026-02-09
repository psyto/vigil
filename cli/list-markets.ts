/**
 * List active restaking risk markets with current data
 *
 * Usage: npm run list-markets -- [--contexts <context1,context2,...>]
 */

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  fetchYieldMatcherContext,
  deserializeYieldMatcherContext,
} from "../sdk/src/yieldMatcher";
import {
  fetchUptimeMatcherContext,
  deserializeUptimeMatcherContext,
} from "../sdk/src/uptimeMatcher";
import { RestakingMarket } from "../sdk/src/types";

const YIELD_MATCHER_MAGIC = BigInt("0x5253544B4d415443");
const UPTIME_MATCHER_MAGIC = BigInt("0x4e434e554d415443");

const YIELD_REGIME_NAMES = [
  "VeryLow",
  "Low",
  "Normal",
  "High",
  "Extreme",
];
const SIGNAL_NAMES = ["NONE", "LOW", "HIGH", "CRITICAL"];

async function detectAndFetchMarket(
  connection: Connection,
  address: PublicKey
): Promise<RestakingMarket | null> {
  const accountInfo = await connection.getAccountInfo(address);
  if (!accountInfo || accountInfo.data.length < 320) return null;

  const data = Buffer.from(accountInfo.data);
  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  );
  const magic = view.getBigUint64(64, true);

  if (magic === YIELD_MATCHER_MAGIC) {
    const ctx = deserializeYieldMatcherContext(data);
    return {
      marketType: "yield",
      ncnName: "NCN Yield",
      ncnAddress: ctx.ncnYieldFeed,
      matcherContext: address,
      currentValue: `${(Number(ctx.currentYieldBps) / 100).toFixed(2)}%`,
      regime: YIELD_REGIME_NAMES[ctx.yieldRegime],
    };
  }

  if (magic === UPTIME_MATCHER_MAGIC) {
    const ctx = deserializeUptimeMatcherContext(data);
    return {
      marketType: "uptime",
      ncnName: "NCN Uptime",
      ncnAddress: ctx.ncnOracle,
      matcherContext: address,
      currentValue: `${(Number(ctx.currentUptimeE6) / 10_000).toFixed(2)}%`,
      signalSeverity:
        SIGNAL_NAMES[Number(ctx.signalSeverity)] ?? "UNKNOWN",
      isResolved: ctx.isResolved,
    };
  }

  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const ctxIdx = args.indexOf("--contexts");

  const rpcUrl =
    process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  let addresses: PublicKey[] = [];

  if (ctxIdx !== -1 && args[ctxIdx + 1]) {
    addresses = args[ctxIdx + 1]
      .split(",")
      .map((a) => new PublicKey(a.trim()));
  } else {
    console.log(
      "Usage: npm run list-markets -- --contexts <addr1,addr2,...>"
    );
    console.log("");
    console.log(
      "Provide comma-separated matcher context addresses."
    );
    console.log("The tool will auto-detect yield vs uptime markets.");
    process.exit(0);
  }

  console.log("\n=== Restaking Risk Markets ===\n");

  const markets: RestakingMarket[] = [];

  for (const addr of addresses) {
    const market = await detectAndFetchMarket(
      connection,
      addr
    );
    if (market) {
      markets.push(market);
    } else {
      console.log(
        `  [?] ${addr.toBase58()} — unknown or invalid`
      );
    }
  }

  // Display yield markets
  const yieldMarkets = markets.filter(
    (m) => m.marketType === "yield"
  );
  if (yieldMarkets.length > 0) {
    console.log("--- Yield Markets ---");
    for (const m of yieldMarkets) {
      console.log(
        `  [YIELD] ${m.ncnName}`
      );
      console.log(
        `    Context: ${m.matcherContext.toBase58()}`
      );
      console.log(
        `    Current APY: ${m.currentValue}`
      );
      console.log(
        `    Regime: ${m.regime}`
      );
      console.log("");
    }
  }

  // Display uptime markets
  const uptimeMarkets = markets.filter(
    (m) => m.marketType === "uptime"
  );
  if (uptimeMarkets.length > 0) {
    console.log("--- Uptime Markets ---");
    for (const m of uptimeMarkets) {
      console.log(
        `  [UPTIME] ${m.ncnName}${m.isResolved ? " [RESOLVED]" : ""}`
      );
      console.log(
        `    Context: ${m.matcherContext.toBase58()}`
      );
      console.log(
        `    Current Uptime: ${m.currentValue}`
      );
      console.log(
        `    Signal: ${m.signalSeverity}`
      );
      console.log("");
    }
  }

  if (markets.length === 0) {
    console.log("  No active markets found.");
  }

  console.log(
    `Total: ${yieldMarkets.length} yield + ${uptimeMarkets.length} uptime = ${markets.length} markets`
  );
}

main().catch(console.error);
