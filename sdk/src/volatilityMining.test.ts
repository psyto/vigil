import { PublicKey } from "@solana/web3.js";
import {
  deriveMiningConfigPda,
  deriveLpStakePda,
  deriveEpochSnapshotPda,
  calculatePendingRewards,
} from "./volatilityMining";
import { LpStakeData, EpochSnapshotData } from "./types";

const VOLATILITY_MINING_PROGRAM_ID = new PublicKey(
  "VMine11111111111111111111111111111111111111"
);

// ===========================================================================
// PDA Derivation
// ===========================================================================

describe("Volatility Mining PDA Derivation", () => {
  test("deriveMiningConfigPda returns deterministic address", () => {
    const [pda1, bump1] = deriveMiningConfigPda();
    const [pda2, bump2] = deriveMiningConfigPda();
    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("deriveMiningConfigPda uses correct seeds", () => {
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("mining_config")],
      VOLATILITY_MINING_PROGRAM_ID
    );
    const [actual] = deriveMiningConfigPda();
    expect(actual.equals(expected)).toBe(true);
  });

  test("deriveLpStakePda returns deterministic address", () => {
    const lpPda = PublicKey.unique();
    const [pda1, bump1] = deriveLpStakePda(lpPda);
    const [pda2, bump2] = deriveLpStakePda(lpPda);
    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("deriveLpStakePda uses correct seeds", () => {
    const lpPda = PublicKey.unique();
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_stake"), lpPda.toBuffer()],
      VOLATILITY_MINING_PROGRAM_ID
    );
    const [actual] = deriveLpStakePda(lpPda);
    expect(actual.equals(expected)).toBe(true);
  });

  test("different LP PDAs produce different stake PDAs", () => {
    const lp1 = PublicKey.unique();
    const lp2 = PublicKey.unique();
    const [pda1] = deriveLpStakePda(lp1);
    const [pda2] = deriveLpStakePda(lp2);
    expect(pda1.equals(pda2)).toBe(false);
  });

  test("deriveEpochSnapshotPda returns deterministic address", () => {
    const epoch = 42n;
    const [pda1, bump1] = deriveEpochSnapshotPda(epoch);
    const [pda2, bump2] = deriveEpochSnapshotPda(epoch);
    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("deriveEpochSnapshotPda uses correct seeds", () => {
    const epoch = 7n;
    const epochBytes = Buffer.alloc(8);
    epochBytes.writeBigUInt64LE(epoch);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("epoch_snapshot"), epochBytes],
      VOLATILITY_MINING_PROGRAM_ID
    );
    const [actual] = deriveEpochSnapshotPda(epoch);
    expect(actual.equals(expected)).toBe(true);
  });

  test("different epochs produce different snapshot PDAs", () => {
    const [pda1] = deriveEpochSnapshotPda(0n);
    const [pda2] = deriveEpochSnapshotPda(1n);
    expect(pda1.equals(pda2)).toBe(false);
  });

  test("PDA bumps are in valid range (0-255)", () => {
    const [, bump1] = deriveMiningConfigPda();
    const [, bump2] = deriveLpStakePda(PublicKey.unique());
    const [, bump3] = deriveEpochSnapshotPda(0n);
    for (const bump of [bump1, bump2, bump3]) {
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    }
  });
});

// ===========================================================================
// Reward Calculation
// ===========================================================================

describe("calculatePendingRewards", () => {
  function makeLpStake(overrides: Partial<LpStakeData> = {}): LpStakeData {
    return {
      lpPda: PublicKey.default,
      owner: PublicKey.default,
      matcherContext: PublicKey.default,
      matcherType: 0,
      liquidityAmountE6: 1_000_000n,
      entrySlot: 0n,
      lastRecordSlot: 0n,
      lastClaimEpoch: 0n,
      currentEpochWeight: 500_000n,
      totalClaimed: 0n,
      isActive: true,
      ...overrides,
    };
  }

  function makeEpochSnapshot(overrides: Partial<EpochSnapshotData> = {}): EpochSnapshotData {
    return {
      epoch: 1n,
      totalRewardWeight: 1_000_000n,
      totalRewards: 10_000_000n,
      totalClaimed: 0n,
      avgRegime: 2,
      slotStart: 0n,
      slotEnd: 100n,
      isFinalized: true,
      ...overrides,
    };
  }

  test("proportional reward: 50% weight gets 50% rewards", () => {
    const lp = makeLpStake({ currentEpochWeight: 500_000n });
    const epoch = makeEpochSnapshot({ totalRewardWeight: 1_000_000n, totalRewards: 10_000_000n });
    const reward = calculatePendingRewards(lp, epoch);
    expect(reward).toBe(5_000_000n);
  });

  test("full weight gets full rewards", () => {
    const lp = makeLpStake({ currentEpochWeight: 1_000_000n });
    const epoch = makeEpochSnapshot({ totalRewardWeight: 1_000_000n, totalRewards: 10_000_000n });
    const reward = calculatePendingRewards(lp, epoch);
    expect(reward).toBe(10_000_000n);
  });

  test("zero weight returns zero rewards", () => {
    const lp = makeLpStake({ currentEpochWeight: 0n });
    const epoch = makeEpochSnapshot({ totalRewardWeight: 1_000_000n, totalRewards: 10_000_000n });
    const reward = calculatePendingRewards(lp, epoch);
    expect(reward).toBe(0n);
  });

  test("zero total weight returns zero rewards", () => {
    const lp = makeLpStake({ currentEpochWeight: 500_000n });
    const epoch = makeEpochSnapshot({ totalRewardWeight: 0n, totalRewards: 10_000_000n });
    const reward = calculatePendingRewards(lp, epoch);
    expect(reward).toBe(0n);
  });

  test("small weight fraction", () => {
    const lp = makeLpStake({ currentEpochWeight: 1n });
    const epoch = makeEpochSnapshot({ totalRewardWeight: 1_000_000n, totalRewards: 10_000_000n });
    const reward = calculatePendingRewards(lp, epoch);
    // 1 * 10_000_000 / 1_000_000 = 10
    expect(reward).toBe(10n);
  });

  test("large values don't overflow", () => {
    const lp = makeLpStake({ currentEpochWeight: 1_000_000_000_000n });
    const epoch = makeEpochSnapshot({
      totalRewardWeight: 10_000_000_000_000n,
      totalRewards: 100_000_000_000n,
    });
    const reward = calculatePendingRewards(lp, epoch);
    // 1e12 * 1e11 / 1e13 = 1e10
    expect(reward).toBe(10_000_000_000n);
  });
});
