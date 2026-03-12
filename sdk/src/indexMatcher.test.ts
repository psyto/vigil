import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  simulateIndexExecPrice,
  deserializeIndexMatcherContext,
  buildIndexMatcherInitIx,
  buildIndexMatcherMatchIx,
  buildIndexSyncIx,
} from "./indexMatcher";
import { IndexMatcherContext, IndexMatcherMode, YieldRegime } from "./types";

// ---------------------------------------------------------------------------
// Helper: build a minimal IndexMatcherContext for pricing tests
// ---------------------------------------------------------------------------
function makeCtx(overrides: Partial<IndexMatcherContext> = {}): IndexMatcherContext {
  return {
    magic: BigInt("0x4944584D41544300"),
    version: 1,
    mode: IndexMatcherMode.FullIndex,
    lpPda: PublicKey.default,
    baseSpreadBps: 20,
    indexVolSpreadBps: 30,
    maxSpreadBps: 200,
    impactKBps: 10,
    weightedAvgApyBps: 850n,
    indexMarkPriceE6: 700_000_000n,
    lastUpdateSlot: 100n,
    indexRegime: YieldRegime.Normal,
    totalRestakedSol: 500_000_000_000_000n,
    ncnCount: 3,
    minNcnCount: 2,
    liquidityNotionalE6: 1_000_000_000n,
    maxFillAbs: 100_000_000n,
    aggregatedFeed: PublicKey.default,
    ...overrides,
  };
}

// ===========================================================================
// Pricing Simulation
// ===========================================================================

describe("simulateIndexExecPrice", () => {
  test("Normal regime: standard pricing", () => {
    const ctx = makeCtx({
      indexRegime: YieldRegime.Normal,
      indexMarkPriceE6: 700_000_000n,
      baseSpreadBps: 20,
      indexVolSpreadBps: 30,
      maxSpreadBps: 200,
    });
    const price = simulateIndexExecPrice(ctx);
    // adjustedIndexVol = 30 * 100 / 100 = 30
    // totalSpread = min(20 + 30, 200) = 50
    // execPrice = 700_000_000 * 10050 / 10000 = 703_500_000
    expect(price).toBe(703_500_000n);
  });

  test("Extreme regime: wider spread", () => {
    const ctx = makeCtx({
      indexRegime: YieldRegime.Extreme,
      indexMarkPriceE6: 700_000_000n,
      baseSpreadBps: 20,
      indexVolSpreadBps: 30,
      maxSpreadBps: 200,
    });
    const price = simulateIndexExecPrice(ctx);
    // adjustedIndexVol = 30 * 250 / 100 = 75
    // totalSpread = min(20 + 75, 200) = 95
    // execPrice = 700_000_000 * 10095 / 10000 = 706_650_000
    expect(price).toBe(706_650_000n);
  });

  test("VeryLow regime: tighter spread", () => {
    const ctx = makeCtx({
      indexRegime: YieldRegime.VeryLow,
      indexMarkPriceE6: 700_000_000n,
      baseSpreadBps: 20,
      indexVolSpreadBps: 30,
      maxSpreadBps: 200,
    });
    const price = simulateIndexExecPrice(ctx);
    // adjustedIndexVol = 30 * 50 / 100 = 15
    // totalSpread = min(20 + 15, 200) = 35
    // execPrice = 700_000_000 * 10035 / 10000 = 702_450_000
    expect(price).toBe(702_450_000n);
  });

  test("spread capping when exceeds max", () => {
    const ctx = makeCtx({
      indexRegime: YieldRegime.Extreme,
      indexMarkPriceE6: 700_000_000n,
      baseSpreadBps: 100,
      indexVolSpreadBps: 200,
      maxSpreadBps: 150,
    });
    const price = simulateIndexExecPrice(ctx);
    // adjustedIndexVol = 200 * 250 / 100 = 500
    // totalSpread = min(100 + 500, 150) = 150
    // execPrice = 700_000_000 * 10150 / 10000 = 710_500_000
    expect(price).toBe(710_500_000n);
  });

  test("zero spread scenario", () => {
    const ctx = makeCtx({
      indexRegime: YieldRegime.Normal,
      indexMarkPriceE6: 500_000_000n,
      baseSpreadBps: 0,
      indexVolSpreadBps: 0,
      maxSpreadBps: 200,
    });
    const price = simulateIndexExecPrice(ctx);
    expect(price).toBe(500_000_000n);
  });

  test("Low regime pricing", () => {
    const ctx = makeCtx({
      indexRegime: YieldRegime.Low,
      indexMarkPriceE6: 200_000_000n,
      baseSpreadBps: 15,
      indexVolSpreadBps: 25,
      maxSpreadBps: 300,
    });
    const price = simulateIndexExecPrice(ctx);
    // adjustedIndexVol = 25 * 75 / 100 = 18 (truncated)
    // totalSpread = min(15 + 18, 300) = 33
    // execPrice = 200_000_000 * 10033 / 10000 = 200_660_000
    expect(price).toBe(200_660_000n);
  });

  test("High regime pricing", () => {
    const ctx = makeCtx({
      indexRegime: YieldRegime.High,
      indexMarkPriceE6: 900_000_000n,
      baseSpreadBps: 20,
      indexVolSpreadBps: 40,
      maxSpreadBps: 200,
    });
    const price = simulateIndexExecPrice(ctx);
    // adjustedIndexVol = 40 * 150 / 100 = 60
    // totalSpread = min(20 + 60, 200) = 80
    // execPrice = 900_000_000 * 10080 / 10000 = 907_200_000
    expect(price).toBe(907_200_000n);
  });

  test("price is always >= mark price", () => {
    for (const regime of [
      YieldRegime.VeryLow,
      YieldRegime.Low,
      YieldRegime.Normal,
      YieldRegime.High,
      YieldRegime.Extreme,
    ]) {
      const ctx = makeCtx({
        indexRegime: regime,
        indexMarkPriceE6: 500_000_000n,
      });
      const price = simulateIndexExecPrice(ctx);
      expect(price).toBeGreaterThanOrEqual(500_000_000n);
    }
  });

  test("pricing matches Rust implementation values", () => {
    // Cross-validate against known Rust test outputs
    expect(simulateIndexExecPrice(makeCtx({
      baseSpreadBps: 20, indexVolSpreadBps: 30, maxSpreadBps: 200,
      indexRegime: YieldRegime.Normal, indexMarkPriceE6: 700_000_000n,
    }))).toBe(703_500_000n);

    expect(simulateIndexExecPrice(makeCtx({
      baseSpreadBps: 20, indexVolSpreadBps: 30, maxSpreadBps: 200,
      indexRegime: YieldRegime.Extreme, indexMarkPriceE6: 700_000_000n,
    }))).toBe(706_650_000n);

    expect(simulateIndexExecPrice(makeCtx({
      baseSpreadBps: 20, indexVolSpreadBps: 30, maxSpreadBps: 200,
      indexRegime: YieldRegime.VeryLow, indexMarkPriceE6: 700_000_000n,
    }))).toBe(702_450_000n);
  });
});

// ===========================================================================
// Context Deserialization
// ===========================================================================

describe("deserializeIndexMatcherContext", () => {
  test("round-trips expected field values from a 320-byte buffer", () => {
    const buf = Buffer.alloc(320);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    const magic = BigInt("0x4944584D41544300");
    view.setBigUint64(64, magic, true);
    view.setUint32(72, 1, true); // version
    buf[76] = IndexMatcherMode.ExclusionIndex; // mode

    const lpPda = PublicKey.unique();
    lpPda.toBuffer().copy(buf, 80);

    view.setUint32(112, 25, true); // baseSpreadBps
    view.setUint32(116, 40, true); // indexVolSpreadBps
    view.setUint32(120, 300, true); // maxSpreadBps
    view.setUint32(124, 15, true); // impactKBps
    view.setBigUint64(128, 850n, true); // weightedAvgApyBps
    view.setBigUint64(136, 850_000_000n, true); // indexMarkPriceE6
    view.setBigUint64(144, 42n, true); // lastUpdateSlot
    buf[152] = YieldRegime.High; // indexRegime
    view.setBigUint64(160, 1_000_000_000_000n, true); // totalRestakedSol
    view.setUint32(168, 5, true); // ncnCount
    view.setUint32(172, 3, true); // minNcnCount
    view.setBigUint64(176, 5_000_000_000n, true); // liquidityNotionalE6
    view.setBigUint64(192, 200_000_000n, true); // maxFillAbs

    const aggregatedFeed = PublicKey.unique();
    aggregatedFeed.toBuffer().copy(buf, 208);

    const ctx = deserializeIndexMatcherContext(buf);

    expect(ctx.magic).toBe(magic);
    expect(ctx.version).toBe(1);
    expect(ctx.mode).toBe(IndexMatcherMode.ExclusionIndex);
    expect(ctx.lpPda.equals(lpPda)).toBe(true);
    expect(ctx.baseSpreadBps).toBe(25);
    expect(ctx.indexVolSpreadBps).toBe(40);
    expect(ctx.maxSpreadBps).toBe(300);
    expect(ctx.impactKBps).toBe(15);
    expect(ctx.weightedAvgApyBps).toBe(850n);
    expect(ctx.indexMarkPriceE6).toBe(850_000_000n);
    expect(ctx.lastUpdateSlot).toBe(42n);
    expect(ctx.indexRegime).toBe(YieldRegime.High);
    expect(ctx.totalRestakedSol).toBe(1_000_000_000_000n);
    expect(ctx.ncnCount).toBe(5);
    expect(ctx.minNcnCount).toBe(3);
    expect(ctx.liquidityNotionalE6).toBe(5_000_000_000n);
    expect(ctx.maxFillAbs).toBe(200_000_000n);
    expect(ctx.aggregatedFeed.equals(aggregatedFeed)).toBe(true);
  });

  test("zeroed buffer returns default values", () => {
    const buf = Buffer.alloc(320);
    const ctx = deserializeIndexMatcherContext(buf);

    expect(ctx.magic).toBe(0n);
    expect(ctx.version).toBe(0);
    expect(ctx.mode).toBe(IndexMatcherMode.FullIndex);
    expect(ctx.baseSpreadBps).toBe(0);
    expect(ctx.indexVolSpreadBps).toBe(0);
    expect(ctx.weightedAvgApyBps).toBe(0n);
    expect(ctx.ncnCount).toBe(0);
    expect(ctx.minNcnCount).toBe(0);
  });
});

// ===========================================================================
// Instruction Builders
// ===========================================================================

const INDEX_MATCHER_PROGRAM_ID = new PublicKey(
  "iDXMtch111111111111111111111111111111111111"
);

describe("buildIndexMatcherMatchIx", () => {
  test("creates instruction with correct program ID and tag", () => {
    const lpPda = PublicKey.unique();
    const ctx = PublicKey.unique();
    const ix = buildIndexMatcherMatchIx(lpPda, ctx);

    expect(ix.programId.equals(INDEX_MATCHER_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(1);
    expect(ix.data[0]).toBe(0x00);
  });

  test("creates instruction with correct accounts", () => {
    const lpPda = PublicKey.unique();
    const ctx = PublicKey.unique();
    const ix = buildIndexMatcherMatchIx(lpPda, ctx);

    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0].pubkey.equals(lpPda)).toBe(true);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(false);
    expect(ix.keys[1].pubkey.equals(ctx)).toBe(true);
    expect(ix.keys[1].isSigner).toBe(false);
    expect(ix.keys[1].isWritable).toBe(true);
  });
});

describe("buildIndexMatcherInitIx", () => {
  test("creates instruction with tag 0x02 and correct data layout", () => {
    const lpPda = PublicKey.unique();
    const matcherCtx = PublicKey.unique();
    const aggregatedFeed = PublicKey.unique();

    const ix = buildIndexMatcherInitIx(
      lpPda,
      matcherCtx,
      IndexMatcherMode.ExclusionIndex,
      25,   // baseSpreadBps
      40,   // indexVolSpreadBps
      300,  // maxSpreadBps
      10,   // impactKBps
      3,    // minNcnCount
      new BN("5000000000"), // liquidityNotionalE6
      new BN("200000000"),  // maxFillAbs
      aggregatedFeed
    );

    expect(ix.programId.equals(INDEX_MATCHER_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(86);
    expect(ix.data[0]).toBe(0x02);
    expect(ix.data[1]).toBe(IndexMatcherMode.ExclusionIndex);
    expect(ix.data.readUInt32LE(2)).toBe(25);
    expect(ix.data.readUInt32LE(6)).toBe(40);
    expect(ix.data.readUInt32LE(10)).toBe(300);
    expect(ix.data.readUInt32LE(14)).toBe(10);
    expect(ix.data.readUInt32LE(18)).toBe(3);
  });

  test("account list has lpPda as signer and context as writable", () => {
    const lpPda = PublicKey.unique();
    const matcherCtx = PublicKey.unique();

    const ix = buildIndexMatcherInitIx(
      lpPda,
      matcherCtx,
      IndexMatcherMode.FullIndex,
      20, 30, 200, 10, 2,
      new BN("1000000000"),
      new BN("100000000"),
      PublicKey.default
    );

    expect(ix.keys[0].pubkey.equals(lpPda)).toBe(true);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[1].pubkey.equals(matcherCtx)).toBe(true);
    expect(ix.keys[1].isWritable).toBe(true);
  });

  test("aggregated feed pubkey is written at correct offset", () => {
    const aggregatedFeed = PublicKey.unique();
    const ix = buildIndexMatcherInitIx(
      PublicKey.unique(),
      PublicKey.unique(),
      IndexMatcherMode.FullIndex,
      20, 30, 200, 10, 2,
      new BN("1000000000"),
      new BN("100000000"),
      aggregatedFeed
    );

    // aggregated feed is at data offset 54..86
    const feedBytes = ix.data.subarray(54, 86);
    expect(Buffer.from(feedBytes).equals(aggregatedFeed.toBuffer())).toBe(true);
  });
});

describe("buildIndexSyncIx", () => {
  test("creates instruction with tag 0x03 and correct data layout", () => {
    const matcherCtx = PublicKey.unique();
    const aggregatedFeed = PublicKey.unique();

    const ix = buildIndexSyncIx(
      matcherCtx,
      aggregatedFeed,
      new BN(850),           // weightedAvgApyBps
      new BN(850_000_000),   // indexMarkPriceE6
      2,                     // regime (Normal)
      new BN("500000000000000"), // totalRestakedSol
      5                      // ncnCount
    );

    expect(ix.programId.equals(INDEX_MATCHER_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(30);
    expect(ix.data[0]).toBe(0x03);
    expect(ix.data[17]).toBe(2); // regime byte
    expect(ix.data.readUInt32LE(26)).toBe(5); // ncnCount
  });

  test("account list includes context (writable) and feed (read-only)", () => {
    const matcherCtx = PublicKey.unique();
    const aggregatedFeed = PublicKey.unique();

    const ix = buildIndexSyncIx(
      matcherCtx,
      aggregatedFeed,
      new BN(850),
      new BN(850_000_000),
      2,
      new BN("500000000000000"),
      5
    );

    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0].pubkey.equals(matcherCtx)).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.equals(aggregatedFeed)).toBe(true);
    expect(ix.keys[1].isWritable).toBe(false);
  });
});
