/**
 * Volatility Mining CLI — Register, claim, and check mining status
 *
 * Usage:
 *   npm run mining -- config
 *   npm run mining -- status --lp-pda <PDA>
 *   npm run mining -- register --lp-pda <PDA> --matcher-context <CTX> --matcher-type <0|1|2>
 *   npm run mining -- claim --lp-pda <PDA> --epoch <NUM>
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  deriveMiningConfigPda,
  deriveLpStakePda,
  deriveEpochSnapshotPda,
  calculatePendingRewards,
} from "../sdk/src/volatilityMining";

const REGIME_NAMES = ["VeryLow", "Low", "Normal", "High", "Extreme"] as const;
const MATCHER_TYPE_NAMES = ["Yield", "Uptime", "Index"] as const;

async function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (!subcommand || subcommand === "help") {
    console.log("Usage:");
    console.log("  config                                    Show mining configuration");
    console.log("  status --lp-pda <PDA>                    Show LP mining status");
    console.log("  register --lp-pda <PDA> --matcher-context <CTX> --matcher-type <0|1|2>");
    console.log("  claim --lp-pda <PDA> --epoch <NUM>");
    process.exit(0);
  }

  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  switch (subcommand) {
    case "config": {
      const [configPda] = deriveMiningConfigPda();
      console.log(`Mining Config PDA: ${configPda.toBase58()}`);
      console.log("(In production, would fetch and display on-chain config)");
      console.log("\nDefault regime multipliers:");
      console.log("  VeryLow:  50  (0.5x rewards)");
      console.log("  Low:      75  (0.75x rewards)");
      console.log("  Normal:   100 (1.0x rewards)");
      console.log("  High:     200 (2.0x rewards)");
      console.log("  Extreme:  400 (4.0x rewards)");
      break;
    }

    case "status": {
      const lpPdaIdx = args.indexOf("--lp-pda");
      if (lpPdaIdx === -1) {
        console.error("Missing --lp-pda");
        process.exit(1);
      }
      const lpPda = new PublicKey(args[lpPdaIdx + 1]);
      const [stakePda] = deriveLpStakePda(lpPda);
      console.log(`LP Stake PDA: ${stakePda.toBase58()}`);
      console.log("(In production, would fetch and display LP stake data)");
      break;
    }

    case "register": {
      const lpPdaIdx = args.indexOf("--lp-pda");
      const ctxIdx = args.indexOf("--matcher-context");
      const typeIdx = args.indexOf("--matcher-type");
      if (lpPdaIdx === -1 || ctxIdx === -1 || typeIdx === -1) {
        console.error("Missing required args: --lp-pda, --matcher-context, --matcher-type");
        process.exit(1);
      }
      const lpPda = new PublicKey(args[lpPdaIdx + 1]);
      const matcherType = parseInt(args[typeIdx + 1]);
      console.log(`Registering LP for volatility mining...`);
      console.log(`  LP PDA: ${lpPda.toBase58()}`);
      console.log(`  Matcher type: ${MATCHER_TYPE_NAMES[matcherType] ?? matcherType}`);
      console.log("(In production, would send register_lp transaction)");
      break;
    }

    case "claim": {
      const lpPdaIdx = args.indexOf("--lp-pda");
      const epochIdx = args.indexOf("--epoch");
      if (lpPdaIdx === -1 || epochIdx === -1) {
        console.error("Missing required args: --lp-pda, --epoch");
        process.exit(1);
      }
      const epoch = BigInt(args[epochIdx + 1]);
      const [snapshotPda] = deriveEpochSnapshotPda(epoch);
      console.log(`Claiming rewards for epoch ${epoch}...`);
      console.log(`  Epoch Snapshot PDA: ${snapshotPda.toBase58()}`);
      console.log("(In production, would send claim_rewards transaction)");
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      process.exit(1);
  }
}

main().catch(console.error);
