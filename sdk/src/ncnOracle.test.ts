import { PublicKey } from "@solana/web3.js";
import {
  deriveNcnPerformanceFeedPda,
  deriveNcnYieldFeedPda,
  deriveAggregatedFeedPda,
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
