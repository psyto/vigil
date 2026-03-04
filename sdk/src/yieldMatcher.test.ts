import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  simulateYieldExecPrice,
  deserializeYieldMatcherContext,
  buildYieldMatcherInitIx,
  buildYieldMatcherMatchIx,
  buildYieldMatcherOracleSyncIx,
} from "./yieldMatcher";
import { YieldMatcherContext, YieldRegime, YieldMatcherMode } from "./types";

// ---------------------------------------------------------------------------
// Helper: build a minimal YieldMatcherContext for pricing tests
// ---------------------------------------------------------------------------
function makeCtx(overrides: Partial<YieldMatcherContext> = {}): YieldMatcherContext {
  return {
    magic: BigInt("0x5253544B4d415443"),
    version: 1,
    mode: YieldMatcherMode.AllNCN,
    lpPda: PublicKey.default,
    baseSpreadBps: 20,
    yieldVolSpreadBps: 30,
    maxSpreadBps: 200,
    impactKBps: 10,
    currentYieldBps: 800n,
    yieldMarkPriceE6: 800_000_000n,
    lastUpdateSlot: 100n,
    yieldRegime: YieldRegime.Normal,
    yield7dAvgBps: 800n,
    yield30dAvgBps: 800n,
    liquidityNotionalE6: 1_000_000_000n,
    maxFillAbs: 100_000_000n,
    ncnYieldFeed: PublicKey.default,
    ncnPerformanceFeed: PublicKey.default,
    ...overrides,
  };
}

// ===========================================================================
// Pricing Simulation
// ===========================================================================

describe("simulateYieldExecPrice", () => {
  test("Normal regime: standard pricing", () => {
    const ctx = makeCtx({
      yieldRegime: YieldRegime.Normal,
      yieldMarkPriceE6: 800_000_000n,
      baseSpreadBps: 20,
      yieldVolSpreadBps: 30,
      maxSpreadBps: 200,
    });
    const price = simulateYieldExecPrice(ctx);
    // adjustedYieldVol = 30 * 100 / 100 = 30
    // totalSpread = min(20 + 30, 200) = 50
    // execPrice = 800_000_000 * 10050 / 10000 = 804_000_000
    expect(price).toBe(804_000_000n);
  });

  test("Extreme regime: wider spread", () => {
    const ctx = makeCtx({
      yieldRegime: YieldRegime.Extreme,
      yieldMarkPriceE6: 800_000_000n,
      baseSpreadBps: 20,
      yieldVolSpreadBps: 30,
      maxSpreadBps: 200,
    });
    const price = simulateYieldExecPrice(ctx);
    // adjustedYieldVol = 30 * 250 / 100 = 75
    // totalSpread = min(20 + 75, 200) = 95
    // execPrice = 800_000_000 * 10095 / 10000 = 807_600_000
    expect(price).toBe(807_600_000n);
  });

  test("VeryLow regime: tighter spread", () => {
    const ctx = makeCtx({
      yieldRegime: YieldRegime.VeryLow,
      yieldMarkPriceE6: 800_000_000n,
      baseSpreadBps: 20,
      yieldVolSpreadBps: 30,
      maxSpreadBps: 200,
    });
    const price = simulateYieldExecPrice(ctx);
    // adjustedYieldVol = 30 * 50 / 100 = 15
    // totalSpread = min(20 + 15, 200) = 35
    // execPrice = 800_000_000 * 10035 / 10000 = 802_800_000
    expect(price).toBe(802_800_000n);
  });

  test("spread capping when exceeds max", () => {
    const ctx = makeCtx({
      yieldRegime: YieldRegime.Extreme,
      yieldMarkPriceE6: 800_000_000n,
      baseSpreadBps: 100,
      yieldVolSpreadBps: 200,
      maxSpreadBps: 150,
    });
    const price = simulateYieldExecPrice(ctx);
    // adjustedYieldVol = 200 * 250 / 100 = 500
    // totalSpread = min(100 + 500, 150) = 150
    // execPrice = 800_000_000 * 10150 / 10000 = 812_000_000
    expect(price).toBe(812_000_000n);
  });

  test("zero spread scenario", () => {
    const ctx = makeCtx({
      yieldRegime: YieldRegime.Normal,
      yieldMarkPriceE6: 500_000_000n,
      baseSpreadBps: 0,
      yieldVolSpreadBps: 0,
      maxSpreadBps: 200,
    });
    const price = simulateYieldExecPrice(ctx);
    expect(price).toBe(500_000_000n);
  });

  test("Low regime pricing", () => {
    const ctx = makeCtx({
      yieldRegime: YieldRegime.Low,
      yieldMarkPriceE6: 200_000_000n,
      baseSpreadBps: 15,
      yieldVolSpreadBps: 25,
      maxSpreadBps: 300,
    });
    const price = simulateYieldExecPrice(ctx);
    // adjustedYieldVol = 25 * 75 / 100 = 18 (truncated)
    // totalSpread = min(15 + 18, 300) = 33
    // execPrice = 200_000_000 * 10033 / 10000 = 200_660_000
    expect(price).toBe(200_660_000n);
  });

  test("High regime pricing", () => {
    const ctx = makeCtx({
      yieldRegime: YieldRegime.High,
      yieldMarkPriceE6: 2_000_000_000n,
      baseSpreadBps: 20,
      yieldVolSpreadBps: 40,
      maxSpreadBps: 200,
    });
    const price = simulateYieldExecPrice(ctx);
    // adjustedYieldVol = 40 * 150 / 100 = 60
    // totalSpread = min(20 + 60, 200) = 80
    // execPrice = 2_000_000_000 * 10080 / 10000 = 2_016_000_000
    expect(price).toBe(2_016_000_000n);
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
        yieldRegime: regime,
        yieldMarkPriceE6: 500_000_000n,
      });
      const price = simulateYieldExecPrice(ctx);
      expect(price).toBeGreaterThanOrEqual(500_000_000n);
    }
  });
});

// ===========================================================================
// Context Deserialization
// ===========================================================================

describe("deserializeYieldMatcherContext", () => {
  test("round-trips expected field values from a 320-byte buffer", () => {
    const buf = Buffer.alloc(320);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    const magic = BigInt("0x5253544B4d415443");
    view.setBigUint64(64, magic, true);
    view.setUint32(72, 1, true); // version
    buf[76] = YieldMatcherMode.SingleNCN; // mode

    const lpPda = PublicKey.unique();
    lpPda.toBuffer().copy(buf, 80);

    view.setUint32(112, 25, true); // baseSpreadBps
    view.setUint32(116, 35, true); // yieldVolSpreadBps
    view.setUint32(120, 300, true); // maxSpreadBps
    view.setUint32(124, 15, true); // impactKBps
    view.setBigUint64(128, 850n, true); // currentYieldBps
    view.setBigUint64(136, 850_000_000n, true); // yieldMarkPriceE6
    view.setBigUint64(144, 42n, true); // lastUpdateSlot
    buf[152] = YieldRegime.High; // yieldRegime
    view.setBigUint64(160, 800n, true); // yield7dAvgBps
    view.setBigUint64(168, 750n, true); // yield30dAvgBps
    view.setBigUint64(176, 5_000_000_000n, true); // liquidityNotionalE6
    view.setBigUint64(192, 200_000_000n, true); // maxFillAbs

    const ncnYieldFeed = PublicKey.unique();
    const ncnPerfFeed = PublicKey.unique();
    ncnYieldFeed.toBuffer().copy(buf, 208);
    ncnPerfFeed.toBuffer().copy(buf, 240);

    const ctx = deserializeYieldMatcherContext(buf);

    expect(ctx.magic).toBe(magic);
    expect(ctx.version).toBe(1);
    expect(ctx.mode).toBe(YieldMatcherMode.SingleNCN);
    expect(ctx.lpPda.equals(lpPda)).toBe(true);
    expect(ctx.baseSpreadBps).toBe(25);
    expect(ctx.yieldVolSpreadBps).toBe(35);
    expect(ctx.maxSpreadBps).toBe(300);
    expect(ctx.impactKBps).toBe(15);
    expect(ctx.currentYieldBps).toBe(850n);
    expect(ctx.yieldMarkPriceE6).toBe(850_000_000n);
    expect(ctx.lastUpdateSlot).toBe(42n);
    expect(ctx.yieldRegime).toBe(YieldRegime.High);
    expect(ctx.yield7dAvgBps).toBe(800n);
    expect(ctx.yield30dAvgBps).toBe(750n);
    expect(ctx.liquidityNotionalE6).toBe(5_000_000_000n);
    expect(ctx.maxFillAbs).toBe(200_000_000n);
    expect(ctx.ncnYieldFeed.equals(ncnYieldFeed)).toBe(true);
    expect(ctx.ncnPerformanceFeed.equals(ncnPerfFeed)).toBe(true);
  });
});

// ===========================================================================
// Instruction Builders
// ===========================================================================

const YIELD_MATCHER_PROGRAM_ID = new PublicKey(
  "YLDMtch111111111111111111111111111111111111"
);

describe("buildYieldMatcherMatchIx", () => {
  test("creates instruction with correct program ID and tag", () => {
    const lpPda = PublicKey.unique();
    const ctx = PublicKey.unique();
    const ix = buildYieldMatcherMatchIx(lpPda, ctx);

    expect(ix.programId.equals(YIELD_MATCHER_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(1);
    expect(ix.data[0]).toBe(0x00);
  });

  test("creates instruction with correct accounts", () => {
    const lpPda = PublicKey.unique();
    const ctx = PublicKey.unique();
    const ix = buildYieldMatcherMatchIx(lpPda, ctx);

    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0].pubkey.equals(lpPda)).toBe(true);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(false);
    expect(ix.keys[1].pubkey.equals(ctx)).toBe(true);
    expect(ix.keys[1].isSigner).toBe(false);
    expect(ix.keys[1].isWritable).toBe(true);
  });
});

describe("buildYieldMatcherInitIx", () => {
  test("creates instruction with tag 0x02 and correct data layout", () => {
    const lpPda = PublicKey.unique();
    const matcherCtx = PublicKey.unique();
    const ncnYieldFeed = PublicKey.unique();
    const ncnPerfFeed = PublicKey.unique();

    const ix = buildYieldMatcherInitIx(
      lpPda,
      matcherCtx,
      YieldMatcherMode.SingleNCN,
      25,   // baseSpreadBps
      35,   // yieldVolSpreadBps
      300,  // maxSpreadBps
      10,   // impactKBps
      new BN("5000000000"), // liquidityNotionalE6
      new BN("200000000"),  // maxFillAbs
      ncnYieldFeed,
      ncnPerfFeed
    );

    expect(ix.programId.equals(YIELD_MATCHER_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(114);
    expect(ix.data[0]).toBe(0x02);
    expect(ix.data[1]).toBe(YieldMatcherMode.SingleNCN);
    expect(ix.data.readUInt32LE(2)).toBe(25);
    expect(ix.data.readUInt32LE(6)).toBe(35);
    expect(ix.data.readUInt32LE(10)).toBe(300);
    expect(ix.data.readUInt32LE(14)).toBe(10);
  });

  test("account list has lpPda as signer and context as writable", () => {
    const lpPda = PublicKey.unique();
    const matcherCtx = PublicKey.unique();

    const ix = buildYieldMatcherInitIx(
      lpPda,
      matcherCtx,
      YieldMatcherMode.AllNCN,
      20, 30, 200, 10,
      new BN("1000000000"),
      new BN("100000000"),
      PublicKey.default,
      PublicKey.default
    );

    expect(ix.keys[0].pubkey.equals(lpPda)).toBe(true);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[1].pubkey.equals(matcherCtx)).toBe(true);
    expect(ix.keys[1].isWritable).toBe(true);
  });
});

describe("buildYieldMatcherOracleSyncIx", () => {
  test("creates instruction with tag 0x03 and correct data layout", () => {
    const matcherCtx = PublicKey.unique();
    const ncnYieldFeed = PublicKey.unique();
    const ncnPerfFeed = PublicKey.unique();

    const ix = buildYieldMatcherOracleSyncIx(
      matcherCtx,
      ncnYieldFeed,
      ncnPerfFeed,
      new BN(800),         // currentYieldBps
      new BN(800_000_000), // yieldMarkPriceE6
      2,                   // regime (Normal)
      new BN(780),         // yield7dAvgBps
      new BN(790)          // yield30dAvgBps
    );

    expect(ix.programId.equals(YIELD_MATCHER_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(34);
    expect(ix.data[0]).toBe(0x03);
    expect(ix.data[17]).toBe(2); // regime byte
  });

  test("account list includes context (writable) and feeds (read-only)", () => {
    const matcherCtx = PublicKey.unique();
    const ncnYieldFeed = PublicKey.unique();
    const ncnPerfFeed = PublicKey.unique();

    const ix = buildYieldMatcherOracleSyncIx(
      matcherCtx,
      ncnYieldFeed,
      ncnPerfFeed,
      new BN(800),
      new BN(800_000_000),
      2,
      new BN(780),
      new BN(790)
    );

    expect(ix.keys.length).toBe(3);
    expect(ix.keys[0].pubkey.equals(matcherCtx)).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.equals(ncnYieldFeed)).toBe(true);
    expect(ix.keys[1].isWritable).toBe(false);
    expect(ix.keys[2].pubkey.equals(ncnPerfFeed)).toBe(true);
    expect(ix.keys[2].isWritable).toBe(false);
  });
});
