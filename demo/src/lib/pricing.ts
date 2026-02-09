/**
 * Vigil pricing engine — exact BigInt port from Rust on-chain programs.
 *
 * Yield: programs/restaking-yield-matcher/src/yield_pricing.rs lines 138-148
 * Uptime: programs/ncn-uptime-matcher/src/uptime_pricing.rs lines 170-204
 *
 * All math uses BigInt to match Rust u64/u128 truncation semantics.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type YieldRegime = 0 | 1 | 2 | 3 | 4; // VeryLow..Extreme

export const REGIME_LABELS: Record<YieldRegime, string> = {
  0: "VeryLow",
  1: "Low",
  2: "Normal",
  3: "High",
  4: "Extreme",
};

export const REGIME_MULTIPLIERS: Record<YieldRegime, bigint> = {
  0: 50n,  // 0.5x
  1: 75n,  // 0.75x
  2: 100n, // 1.0x
  3: 150n, // 1.5x
  4: 250n, // 2.5x
};

export type SignalSeverity = 0 | 1 | 2 | 3; // NONE, LOW, HIGH, CRITICAL

export const SIGNAL_LABELS: Record<SignalSeverity, string> = {
  0: "NONE",
  1: "LOW",
  2: "HIGH",
  3: "CRITICAL",
};

/** Signal severity → additional spread bps (keeper convention) */
export const SIGNAL_SPREAD_BPS: Record<SignalSeverity, bigint> = {
  0: 0n,
  1: 15n,
  2: 50n,
  3: 200n,
};

export const MAX_PROBABILITY = 1_000_000n;

// ---------------------------------------------------------------------------
// Yield pricing (restaking-yield-matcher)
// ---------------------------------------------------------------------------

export interface YieldPricingParams {
  baseSpreadBps: bigint;
  yieldVolSpreadBps: bigint;
  maxSpreadBps: bigint;
  regime: YieldRegime;
  yieldMarkPriceE6: bigint;
}

export interface YieldPricingResult {
  regimeMultiplier: bigint;
  adjustedYieldVol: bigint;
  totalSpread: bigint;
  execPrice: bigint;
}

export function computeYieldPrice(p: YieldPricingParams): YieldPricingResult {
  const regimeMultiplier = REGIME_MULTIPLIERS[p.regime];
  const adjustedYieldVol = (p.yieldVolSpreadBps * regimeMultiplier) / 100n;
  const totalSpread = bigMin(p.baseSpreadBps + adjustedYieldVol, p.maxSpreadBps);
  const execPrice = computeExecPrice(p.yieldMarkPriceE6, totalSpread);

  return { regimeMultiplier, adjustedYieldVol, totalSpread, execPrice };
}

// ---------------------------------------------------------------------------
// Uptime pricing (ncn-uptime-matcher)
// ---------------------------------------------------------------------------

export interface UptimePricingParams {
  baseSpreadBps: bigint;
  edgeSpreadBps: bigint;
  maxSpreadBps: bigint;
  uptimeE6: bigint;
  signalAdjustedSpread: bigint;
}

export interface UptimePricingResult {
  edgeDenominator: bigint;
  edgeFactor: bigint;
  adjustedEdge: bigint;
  totalSpread: bigint;
  execPrice: bigint;
}

export function computeUptimePrice(p: UptimePricingParams): UptimePricingResult {
  const pB = p.uptimeE6;
  const oneMinusP = MAX_PROBABILITY - pB;

  // p * (1-p) * 4 / 1e12
  const edgeDenominator = (pB * oneMinusP * 4n) / 1_000_000_000_000n;

  const edgeFactor =
    edgeDenominator > 0n
      ? bigMin(1_000_000n / edgeDenominator, 10_000_000n)
      : 10_000_000n;

  const adjustedEdge = (p.edgeSpreadBps * edgeFactor) / 1_000_000n;

  const totalSpread = bigMin(
    p.baseSpreadBps + adjustedEdge + p.signalAdjustedSpread,
    p.maxSpreadBps,
  );

  // exec_price = uptime_e6 * (10000 + totalSpread) / 10000
  const spreadMult = 10_000n + totalSpread;
  const execPrice = (pB * spreadMult) / 10_000n;

  return { edgeDenominator, edgeFactor, adjustedEdge, totalSpread, execPrice };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Replicates matcher_common::compute_exec_price */
function computeExecPrice(price: bigint, spreadBps: bigint): bigint {
  const multiplier = 10_000n + spreadBps;
  return (price * multiplier) / 10_000n;
}

function bigMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

// ---------------------------------------------------------------------------
// Chart data generators
// ---------------------------------------------------------------------------

/** For the yield bar chart: totalSpread for each regime at current params */
export function yieldSpreadByRegime(
  baseSpreadBps: bigint,
  yieldVolSpreadBps: bigint,
  maxSpreadBps: bigint,
): { regime: string; spread: number }[] {
  return ([0, 1, 2, 3, 4] as YieldRegime[]).map((r) => {
    const result = computeYieldPrice({
      baseSpreadBps,
      yieldVolSpreadBps,
      maxSpreadBps,
      regime: r,
      yieldMarkPriceE6: 800_000_000n, // doesn't matter for spread
    });
    return { regime: REGIME_LABELS[r], spread: Number(result.totalSpread) };
  });
}

/** For the uptime smile chart: totalSpread across uptime 1%→99% */
export function uptimeSpreadSmile(
  baseSpreadBps: bigint,
  edgeSpreadBps: bigint,
  maxSpreadBps: bigint,
  signalSpread: bigint,
): { uptime: number; spread: number }[] {
  const points: { uptime: number; spread: number }[] = [];
  for (let pct = 1; pct <= 99; pct++) {
    const uptimeE6 = BigInt(pct) * 10_000n; // pct% as e6
    const result = computeUptimePrice({
      baseSpreadBps,
      edgeSpreadBps,
      maxSpreadBps,
      uptimeE6,
      signalAdjustedSpread: signalSpread,
    });
    points.push({ uptime: pct, spread: Number(result.totalSpread) });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Test vectors (must match Rust tests exactly)
// ---------------------------------------------------------------------------

export function runTestVectors(): { name: string; pass: boolean; expected: bigint; got: bigint }[] {
  const results: { name: string; pass: boolean; expected: bigint; got: bigint }[] = [];

  // Yield: Normal regime, mark=800M
  {
    const r = computeYieldPrice({
      baseSpreadBps: 20n, yieldVolSpreadBps: 30n, maxSpreadBps: 200n,
      regime: 2, yieldMarkPriceE6: 800_000_000n,
    });
    results.push({ name: "Yield Normal", pass: r.execPrice === 804_000_000n, expected: 804_000_000n, got: r.execPrice });
  }

  // Yield: Extreme regime, mark=800M
  {
    const r = computeYieldPrice({
      baseSpreadBps: 20n, yieldVolSpreadBps: 30n, maxSpreadBps: 200n,
      regime: 4, yieldMarkPriceE6: 800_000_000n,
    });
    results.push({ name: "Yield Extreme", pass: r.execPrice === 807_600_000n, expected: 807_600_000n, got: r.execPrice });
  }

  // Yield: VeryLow regime, mark=800M
  {
    const r = computeYieldPrice({
      baseSpreadBps: 20n, yieldVolSpreadBps: 30n, maxSpreadBps: 200n,
      regime: 0, yieldMarkPriceE6: 800_000_000n,
    });
    results.push({ name: "Yield VeryLow", pass: r.execPrice === 802_800_000n, expected: 802_800_000n, got: r.execPrice });
  }

  // Uptime: 50%, no signal
  {
    const r = computeUptimePrice({
      baseSpreadBps: 20n, edgeSpreadBps: 30n, maxSpreadBps: 500n,
      uptimeE6: 500_000n, signalAdjustedSpread: 0n,
    });
    results.push({ name: "Uptime 50%", pass: r.totalSpread === 50n && r.execPrice === 502_500n, expected: 502_500n, got: r.execPrice });
  }

  // Uptime: 99.5%, no signal
  {
    const r = computeUptimePrice({
      baseSpreadBps: 20n, edgeSpreadBps: 30n, maxSpreadBps: 500n,
      uptimeE6: 995_000n, signalAdjustedSpread: 0n,
    });
    results.push({ name: "Uptime 99.5%", pass: r.totalSpread === 320n && r.execPrice === 1_026_840n, expected: 1_026_840n, got: r.execPrice });
  }

  // Uptime: 10%, no signal
  {
    const r = computeUptimePrice({
      baseSpreadBps: 20n, edgeSpreadBps: 30n, maxSpreadBps: 500n,
      uptimeE6: 100_000n, signalAdjustedSpread: 0n,
    });
    results.push({ name: "Uptime 10%", pass: r.totalSpread === 320n && r.execPrice === 103_200n, expected: 103_200n, got: r.execPrice });
  }

  return results;
}
