/**
 * Volatility Mining SDK — Interact with the volatility-mining program
 */

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  MiningConfigData,
  LpStakeData,
  EpochSnapshotData,
} from "./types";

const VOLATILITY_MINING_PROGRAM_ID = new PublicKey(
  "VMine11111111111111111111111111111111111111"
);

// ============================================================================
// PDA Derivers
// ============================================================================

export function deriveMiningConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mining_config")],
    VOLATILITY_MINING_PROGRAM_ID
  );
}

export function deriveLpStakePda(lpPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lp_stake"), lpPda.toBuffer()],
    VOLATILITY_MINING_PROGRAM_ID
  );
}

export function deriveEpochSnapshotPda(epoch: bigint): [PublicKey, number] {
  const epochBytes = Buffer.alloc(8);
  epochBytes.writeBigUInt64LE(epoch);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("epoch_snapshot"), epochBytes],
    VOLATILITY_MINING_PROGRAM_ID
  );
}

// ============================================================================
// Reward Calculation (client-side)
// ============================================================================

export function calculatePendingRewards(
  lpStake: LpStakeData,
  epochSnapshot: EpochSnapshotData
): bigint {
  if (epochSnapshot.totalRewardWeight === 0n) return 0n;
  if (lpStake.currentEpochWeight === 0n) return 0n;

  return (
    (lpStake.currentEpochWeight * epochSnapshot.totalRewards) /
    epochSnapshot.totalRewardWeight
  );
}
