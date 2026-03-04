import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  simulateUptimeExecPrice,
  deserializeUptimeMatcherContext,
  buildUptimeMatcherInitIx,
  buildUptimeMatcherMatchIx,
  buildUptimeSyncIx,
  buildResolveIx,
} from "./uptimeMatcher";
import {
  UptimeMatcherContext,
  UptimeMatcherMode,
  ResolutionOutcome,
} from "./types";

// ---------------------------------------------------------------------------
// Helper: build a minimal UptimeMatcherContext for pricing tests
// ---------------------------------------------------------------------------
function makeCtx(
  overrides: Partial<UptimeMatcherContext> = {}
): UptimeMatcherContext {
  return {
    magic: BigInt("0x4e434e554d415443"),
    version: 1,
    mode: UptimeMatcherMode.Continuous,
    lpPda: PublicKey.default,
    baseSpreadBps: 20,
    edgeSpreadBps: 30,
    maxSpreadBps: 500,
    impactKBps: 10,
    currentUptimeE6: 995_000n,
    uptimeMarkE6: 995_000n,
    lastUpdateSlot: 100n,
    resolutionTimestamp: 0n,
    isResolved: false,
    resolutionOutcome: ResolutionOutcome.Safe,
    signalSeverity: 0n,
    signalAdjustedSpread: 0n,
    liquidityNotionalE6: 1_000_000_000n,
    maxFillAbs: 100_000_000n,
    ncnOracle: PublicKey.default,
    ...overrides,
  };
}

// ===========================================================================
// Pricing Simulation
// ===========================================================================

describe("simulateUptimeExecPrice", () => {
  test("50% uptime: balanced market", () => {
    const ctx = makeCtx({
      currentUptimeE6: 500_000n,
      baseSpreadBps: 20,
      edgeSpreadBps: 30,
      maxSpreadBps: 500,
      signalAdjustedSpread: 0n,
    });
    const price = simulateUptimeExecPrice(ctx);
    // p=500000, 1-p=500000
    // denom = 500000*500000*4 / 1e12 = 1_000_000_000_000 / 1e12 = 1
    // edgeFactor = 1_000_000 / 1 = 1_000_000
    // adjustedEdge = 30 * 1_000_000 / 1_000_000 = 30
    // totalSpread = min(20 + 30 + 0, 500) = 50
    // execPrice = 500_000 * 10050 / 10000 = 502_500
    expect(price).toBe(502_500n);
  });

  test("99.5% uptime: healthy NCN, max edge factor", () => {
    const ctx = makeCtx({
      currentUptimeE6: 995_000n,
      baseSpreadBps: 20,
      edgeSpreadBps: 30,
      maxSpreadBps: 500,
      signalAdjustedSpread: 0n,
    });
    const price = simulateUptimeExecPrice(ctx);
    // p=995000, 1-p=5000
    // denom = 995000*5000*4 / 1e12 = 0 (integer truncation)
    // edgeFactor = 10_000_000 (max)
    // adjustedEdge = 30 * 10_000_000 / 1_000_000 = 300
    // totalSpread = min(20 + 300, 500) = 320
    // execPrice = 995_000 * 10320 / 10000 = 1_026_840
    expect(price).toBe(1_026_840n);
  });

  test("10% uptime: NCN in trouble", () => {
    const ctx = makeCtx({
      currentUptimeE6: 100_000n,
      baseSpreadBps: 20,
      edgeSpreadBps: 30,
      maxSpreadBps: 500,
      signalAdjustedSpread: 0n,
    });
    const price = simulateUptimeExecPrice(ctx);
    expect(price).toBe(103_200n);
  });

  test("signal adjustment widens spread", () => {
    const ctx = makeCtx({
      currentUptimeE6: 500_000n,
      baseSpreadBps: 20,
      edgeSpreadBps: 300,
      maxSpreadBps: 500,
      signalAdjustedSpread: 50n,
    });
    const price = simulateUptimeExecPrice(ctx);
    // adjustedEdge = 300 * 1_000_000 / 1_000_000 = 300
    // totalSpread = min(20 + 300 + 50, 500) = 370
    // execPrice = 500_000 * 10370 / 10000 = 518_500
    expect(price).toBe(518_500n);
  });

  test("critical signal at 99.5% caps to max spread", () => {
    const ctx = makeCtx({
      currentUptimeE6: 995_000n,
      baseSpreadBps: 20,
      edgeSpreadBps: 30,
      maxSpreadBps: 500,
      signalAdjustedSpread: 200n,
    });
    const price = simulateUptimeExecPrice(ctx);
    // base(20) + edge(300) + signal(200) = 520, capped to 500
    // execPrice = 995_000 * 10500 / 10000 = 1_044_750
    expect(price).toBe(1_044_750n);
  });

  test("max spread capping", () => {
    const ctx = makeCtx({
      currentUptimeE6: 500_000n,
      baseSpreadBps: 20,
      edgeSpreadBps: 1000,
      maxSpreadBps: 500,
      signalAdjustedSpread: 500n,
    });
    const price = simulateUptimeExecPrice(ctx);
    // totalSpread = min(20 + 1000 + 500, 500) = 500
    // execPrice = 500_000 * 10500 / 10000 = 525_000
    expect(price).toBe(525_000n);
  });

  test("price is always >= base probability", () => {
    for (const uptime of [100_000n, 500_000n, 900_000n, 995_000n]) {
      const ctx = makeCtx({ currentUptimeE6: uptime });
      const price = simulateUptimeExecPrice(ctx);
      expect(price).toBeGreaterThanOrEqual(uptime);
    }
  });

  test("higher spread always produces higher or equal price", () => {
    const base = makeCtx({
      currentUptimeE6: 500_000n,
      baseSpreadBps: 10,
    });
    const wider = makeCtx({
      currentUptimeE6: 500_000n,
      baseSpreadBps: 50,
    });
    expect(simulateUptimeExecPrice(wider)).toBeGreaterThanOrEqual(
      simulateUptimeExecPrice(base)
    );
  });
});

// ===========================================================================
// Context Deserialization
// ===========================================================================

describe("deserializeUptimeMatcherContext", () => {
  test("round-trips expected field values from a 320-byte buffer", () => {
    const buf = Buffer.alloc(320);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    const magic = BigInt("0x4e434e554d415443");
    view.setBigUint64(64, magic, true);
    view.setUint32(72, 1, true); // version
    buf[76] = UptimeMatcherMode.SlashingSettlement; // mode

    const lpPda = PublicKey.unique();
    lpPda.toBuffer().copy(buf, 80);

    view.setUint32(112, 25, true); // baseSpreadBps
    view.setUint32(116, 40, true); // edgeSpreadBps
    view.setUint32(120, 600, true); // maxSpreadBps
    view.setUint32(124, 15, true); // impactKBps
    view.setBigUint64(128, 990_000n, true); // currentUptimeE6
    view.setBigUint64(136, 990_000n, true); // uptimeMarkE6
    view.setBigUint64(144, 42n, true); // lastUpdateSlot
    view.setBigInt64(152, 1700000000n, true); // resolutionTimestamp
    buf[160] = 0; // isResolved = false
    buf[161] = 1; // resolutionOutcome = Safe
    view.setBigUint64(168, 2n, true); // signalSeverity = HIGH
    view.setBigUint64(176, 50n, true); // signalAdjustedSpread
    view.setBigUint64(184, 3_000_000_000n, true); // liquidityNotionalE6
    view.setBigUint64(200, 150_000_000n, true); // maxFillAbs

    const ncnOracle = PublicKey.unique();
    ncnOracle.toBuffer().copy(buf, 216);

    const ctx = deserializeUptimeMatcherContext(buf);

    expect(ctx.magic).toBe(magic);
    expect(ctx.version).toBe(1);
    expect(ctx.mode).toBe(UptimeMatcherMode.SlashingSettlement);
    expect(ctx.lpPda.equals(lpPda)).toBe(true);
    expect(ctx.baseSpreadBps).toBe(25);
    expect(ctx.edgeSpreadBps).toBe(40);
    expect(ctx.maxSpreadBps).toBe(600);
    expect(ctx.impactKBps).toBe(15);
    expect(ctx.currentUptimeE6).toBe(990_000n);
    expect(ctx.uptimeMarkE6).toBe(990_000n);
    expect(ctx.lastUpdateSlot).toBe(42n);
    expect(ctx.resolutionTimestamp).toBe(1700000000n);
    expect(ctx.isResolved).toBe(false);
    expect(ctx.resolutionOutcome).toBe(ResolutionOutcome.Safe);
    expect(ctx.signalSeverity).toBe(2n);
    expect(ctx.signalAdjustedSpread).toBe(50n);
    expect(ctx.liquidityNotionalE6).toBe(3_000_000_000n);
    expect(ctx.maxFillAbs).toBe(150_000_000n);
    expect(ctx.ncnOracle.equals(ncnOracle)).toBe(true);
  });
});

// ===========================================================================
// Instruction Builders
// ===========================================================================

const UPTIME_MATCHER_PROGRAM_ID = new PublicKey(
  "UPTMtch111111111111111111111111111111111111"
);

describe("buildUptimeMatcherMatchIx", () => {
  test("creates instruction with correct program ID and tag", () => {
    const lpPda = PublicKey.unique();
    const ctx = PublicKey.unique();
    const ix = buildUptimeMatcherMatchIx(lpPda, ctx);

    expect(ix.programId.equals(UPTIME_MATCHER_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(1);
    expect(ix.data[0]).toBe(0x00);
  });

  test("creates instruction with correct account layout", () => {
    const lpPda = PublicKey.unique();
    const ctx = PublicKey.unique();
    const ix = buildUptimeMatcherMatchIx(lpPda, ctx);

    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0].pubkey.equals(lpPda)).toBe(true);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[1].pubkey.equals(ctx)).toBe(true);
    expect(ix.keys[1].isWritable).toBe(true);
  });
});

describe("buildUptimeMatcherInitIx", () => {
  test("creates instruction with tag 0x02 and correct data layout", () => {
    const lpPda = PublicKey.unique();
    const matcherCtx = PublicKey.unique();
    const oracle = PublicKey.unique();

    const ix = buildUptimeMatcherInitIx(
      lpPda,
      matcherCtx,
      UptimeMatcherMode.Continuous,
      25,   // baseSpreadBps
      40,   // edgeSpreadBps
      600,  // maxSpreadBps
      15,   // impactKBps
      new BN(990_000),      // initialUptimeE6
      new BN(1700000000),   // resolutionTimestamp
      new BN("3000000000"), // liquidityNotionalE6
      new BN("150000000"),  // maxFillAbs
      oracle
    );

    expect(ix.programId.equals(UPTIME_MATCHER_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(98);
    expect(ix.data[0]).toBe(0x02);
    expect(ix.data[1]).toBe(UptimeMatcherMode.Continuous);
    expect(ix.data.readUInt32LE(2)).toBe(25);
    expect(ix.data.readUInt32LE(6)).toBe(40);
    expect(ix.data.readUInt32LE(10)).toBe(600);
    expect(ix.data.readUInt32LE(14)).toBe(15);
  });
});

describe("buildUptimeSyncIx", () => {
  test("creates instruction with tag 0x03", () => {
    const matcherCtx = PublicKey.unique();
    const oracle = PublicKey.unique();

    const ix = buildUptimeSyncIx(
      matcherCtx,
      oracle,
      new BN(990_000),
      new BN(1),
      new BN(25)
    );

    expect(ix.programId.equals(UPTIME_MATCHER_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(25);
    expect(ix.data[0]).toBe(0x03);
    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0].pubkey.equals(matcherCtx)).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.equals(oracle)).toBe(true);
    expect(ix.keys[1].isWritable).toBe(false);
  });
});

describe("buildResolveIx", () => {
  test("creates Slashed resolution instruction", () => {
    const matcherCtx = PublicKey.unique();
    const oracle = PublicKey.unique();

    const ix = buildResolveIx(matcherCtx, oracle, ResolutionOutcome.Slashed);

    expect(ix.data.length).toBe(2);
    expect(ix.data[0]).toBe(0x04);
    expect(ix.data[1]).toBe(ResolutionOutcome.Slashed);
    expect(ix.keys[1].isSigner).toBe(true);
  });

  test("creates Safe resolution instruction", () => {
    const matcherCtx = PublicKey.unique();
    const oracle = PublicKey.unique();

    const ix = buildResolveIx(matcherCtx, oracle, ResolutionOutcome.Safe);

    expect(ix.data[0]).toBe(0x04);
    expect(ix.data[1]).toBe(ResolutionOutcome.Safe);
  });
});
