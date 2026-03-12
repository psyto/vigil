import { PublicKey } from "@solana/web3.js";
import {
  deriveNcnPerformanceFeedPda,
  deriveNcnYieldFeedPda,
  deriveAggregatedFeedPda,
  deriveReporterRegistryPda,
  derivePendingSubmissionPda,
  deriveReporterStakePda,
} from "./ncnOracle";

const NCN_ORACLE_PROGRAM_ID = new PublicKey(
  "NCNRsk1111111111111111111111111111111111111"
);

describe("NCN Oracle PDA Derivation", () => {
  const ncnAddress = new PublicKey(
    "11111111111111111111111111111111"
  );

  test("deriveNcnPerformanceFeedPda returns deterministic address", () => {
    const [pda1, bump1] = deriveNcnPerformanceFeedPda(ncnAddress);
    const [pda2, bump2] = deriveNcnPerformanceFeedPda(ncnAddress);
    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("deriveNcnPerformanceFeedPda uses correct seeds", () => {
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("ncn_perf_feed"), ncnAddress.toBuffer()],
      NCN_ORACLE_PROGRAM_ID
    );
    const [actual] = deriveNcnPerformanceFeedPda(ncnAddress);
    expect(actual.equals(expected)).toBe(true);
  });

  test("deriveNcnYieldFeedPda returns deterministic address", () => {
    const [pda1, bump1] = deriveNcnYieldFeedPda(ncnAddress);
    const [pda2, bump2] = deriveNcnYieldFeedPda(ncnAddress);
    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("deriveNcnYieldFeedPda uses correct seeds", () => {
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("ncn_yield_feed"), ncnAddress.toBuffer()],
      NCN_ORACLE_PROGRAM_ID
    );
    const [actual] = deriveNcnYieldFeedPda(ncnAddress);
    expect(actual.equals(expected)).toBe(true);
  });

  test("deriveAggregatedFeedPda returns deterministic address", () => {
    const [pda1, bump1] = deriveAggregatedFeedPda();
    const [pda2, bump2] = deriveAggregatedFeedPda();
    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("deriveAggregatedFeedPda uses correct seeds", () => {
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("aggregated_restaking_feed")],
      NCN_ORACLE_PROGRAM_ID
    );
    const [actual] = deriveAggregatedFeedPda();
    expect(actual.equals(expected)).toBe(true);
  });

  test("different NCN addresses produce different PDAs", () => {
    const ncn1 = new PublicKey("11111111111111111111111111111111");
    const ncn2 = PublicKey.unique();
    const [pda1] = deriveNcnPerformanceFeedPda(ncn1);
    const [pda2] = deriveNcnPerformanceFeedPda(ncn2);
    expect(pda1.equals(pda2)).toBe(false);
  });

  test("performance and yield PDAs differ for the same NCN", () => {
    const [perfPda] = deriveNcnPerformanceFeedPda(ncnAddress);
    const [yieldPda] = deriveNcnYieldFeedPda(ncnAddress);
    expect(perfPda.equals(yieldPda)).toBe(false);
  });

  test("PDA bump is in valid range (0-255)", () => {
    const [, bump] = deriveNcnPerformanceFeedPda(ncnAddress);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });
});

describe("Reporter PDA Derivation", () => {
  const ncnAddress = new PublicKey("11111111111111111111111111111111");

  test("deriveReporterRegistryPda returns deterministic address", () => {
    const [pda1, bump1] = deriveReporterRegistryPda(ncnAddress);
    const [pda2, bump2] = deriveReporterRegistryPda(ncnAddress);
    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("deriveReporterRegistryPda uses correct seeds", () => {
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("reporter_registry"), ncnAddress.toBuffer()],
      NCN_ORACLE_PROGRAM_ID
    );
    const [actual] = deriveReporterRegistryPda(ncnAddress);
    expect(actual.equals(expected)).toBe(true);
  });

  test("different NCNs produce different reporter registries", () => {
    const ncn2 = PublicKey.unique();
    const [pda1] = deriveReporterRegistryPda(ncnAddress);
    const [pda2] = deriveReporterRegistryPda(ncn2);
    expect(pda1.equals(pda2)).toBe(false);
  });

  test("derivePendingSubmissionPda returns deterministic address", () => {
    const round = 5n;
    const [pda1, bump1] = derivePendingSubmissionPda(ncnAddress, round);
    const [pda2, bump2] = derivePendingSubmissionPda(ncnAddress, round);
    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("derivePendingSubmissionPda uses correct seeds", () => {
    const round = 42n;
    const roundBytes = Buffer.alloc(8);
    roundBytes.writeBigUInt64LE(round);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending_submission"), ncnAddress.toBuffer(), roundBytes],
      NCN_ORACLE_PROGRAM_ID
    );
    const [actual] = derivePendingSubmissionPda(ncnAddress, round);
    expect(actual.equals(expected)).toBe(true);
  });

  test("different rounds produce different submission PDAs", () => {
    const [pda1] = derivePendingSubmissionPda(ncnAddress, 0n);
    const [pda2] = derivePendingSubmissionPda(ncnAddress, 1n);
    expect(pda1.equals(pda2)).toBe(false);
  });

  test("deriveReporterStakePda returns deterministic address", () => {
    const registry = PublicKey.unique();
    const reporter = PublicKey.unique();
    const [pda1, bump1] = deriveReporterStakePda(registry, reporter);
    const [pda2, bump2] = deriveReporterStakePda(registry, reporter);
    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("deriveReporterStakePda uses correct seeds", () => {
    const registry = PublicKey.unique();
    const reporter = PublicKey.unique();
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("reporter_stake"), registry.toBuffer(), reporter.toBuffer()],
      NCN_ORACLE_PROGRAM_ID
    );
    const [actual] = deriveReporterStakePda(registry, reporter);
    expect(actual.equals(expected)).toBe(true);
  });

  test("different reporters produce different stake PDAs", () => {
    const registry = PublicKey.unique();
    const reporter1 = PublicKey.unique();
    const reporter2 = PublicKey.unique();
    const [pda1] = deriveReporterStakePda(registry, reporter1);
    const [pda2] = deriveReporterStakePda(registry, reporter2);
    expect(pda1.equals(pda2)).toBe(false);
  });

  test("registry PDA differs from performance/yield feed PDAs", () => {
    const [registryPda] = deriveReporterRegistryPda(ncnAddress);
    const [perfPda] = deriveNcnPerformanceFeedPda(ncnAddress);
    const [yieldPda] = deriveNcnYieldFeedPda(ncnAddress);
    expect(registryPda.equals(perfPda)).toBe(false);
    expect(registryPda.equals(yieldPda)).toBe(false);
  });
});
