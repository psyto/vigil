/**
 * Yield Matcher SDK — Interact with the restaking-yield-matcher program
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  YieldMatcherContext,
  YieldRegime,
  YieldMatcherMode,
} from "./types";

const YIELD_MATCHER_MAGIC = BigInt("0x5253544B4d415443"); // "RSTKMATC"

const YIELD_MATCHER_PROGRAM_ID = new PublicKey(
  "YLDMtch111111111111111111111111111111111111"
);

// ============================================================================
// Context Deserialization (320-byte raw context account)
// ============================================================================

export function deserializeYieldMatcherContext(
  data: Buffer
): YieldMatcherContext {
  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  );

  return {
    magic: view.getBigUint64(64, true),
    version: view.getUint32(72, true),
    mode: data[76] as YieldMatcherMode,
    lpPda: new PublicKey(data.subarray(80, 112)),
    baseSpreadBps: view.getUint32(112, true),
    yieldVolSpreadBps: view.getUint32(116, true),
    maxSpreadBps: view.getUint32(120, true),
    impactKBps: view.getUint32(124, true),
    currentYieldBps: view.getBigUint64(128, true),
    yieldMarkPriceE6: view.getBigUint64(136, true),
    lastUpdateSlot: view.getBigUint64(144, true),
    yieldRegime: data[152] as YieldRegime,
    yield7dAvgBps: view.getBigUint64(160, true),
    yield30dAvgBps: view.getBigUint64(168, true),
    liquidityNotionalE6: view.getBigUint64(176, true),
    maxFillAbs: view.getBigUint64(192, true),
    ncnYieldFeed: new PublicKey(data.subarray(208, 240)),
    ncnPerformanceFeed: new PublicKey(data.subarray(240, 272)),
  };
}

export async function fetchYieldMatcherContext(
  connection: Connection,
  address: PublicKey
): Promise<YieldMatcherContext | null> {
  const accountInfo = await connection.getAccountInfo(address);
  if (!accountInfo || accountInfo.data.length < 320) return null;
  return deserializeYieldMatcherContext(
    Buffer.from(accountInfo.data)
  );
}

// ============================================================================
// Instruction Builders
// ============================================================================

/** Build Init instruction (tag 0x02) */
export function buildYieldMatcherInitIx(
  lpPda: PublicKey,
  matcherContext: PublicKey,
  mode: YieldMatcherMode,
  baseSpreadBps: number,
  yieldVolSpreadBps: number,
  maxSpreadBps: number,
  impactKBps: number,
  liquidityNotionalE6: BN,
  maxFillAbs: BN,
  ncnYieldFeed: PublicKey,
  ncnPerformanceFeed: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(114);
  data.writeUInt8(0x02, 0);
  data.writeUInt8(mode, 1);
  data.writeUInt32LE(baseSpreadBps, 2);
  data.writeUInt32LE(yieldVolSpreadBps, 6);
  data.writeUInt32LE(maxSpreadBps, 10);
  data.writeUInt32LE(impactKBps, 14);
  liquidityNotionalE6.toBuffer("le", 16).copy(data, 18);
  maxFillAbs.toBuffer("le", 16).copy(data, 34);
  ncnYieldFeed.toBuffer().copy(data, 50);
  ncnPerformanceFeed.toBuffer().copy(data, 82);

  return new TransactionInstruction({
    programId: YIELD_MATCHER_PROGRAM_ID,
    keys: [
      { pubkey: lpPda, isSigner: true, isWritable: false },
      {
        pubkey: matcherContext,
        isSigner: false,
        isWritable: true,
      },
    ],
    data,
  });
}

/** Build Match instruction (tag 0x00) */
export function buildYieldMatcherMatchIx(
  lpPda: PublicKey,
  matcherContext: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(1);
  data.writeUInt8(0x00, 0);

  return new TransactionInstruction({
    programId: YIELD_MATCHER_PROGRAM_ID,
    keys: [
      { pubkey: lpPda, isSigner: true, isWritable: false },
      {
        pubkey: matcherContext,
        isSigner: false,
        isWritable: true,
      },
    ],
    data,
  });
}

/** Build OracleSync instruction (tag 0x03) */
export function buildYieldMatcherOracleSyncIx(
  matcherContext: PublicKey,
  ncnYieldFeed: PublicKey,
  ncnPerformanceFeed: PublicKey,
  currentYieldBps: BN,
  yieldMarkPriceE6: BN,
  regime: number,
  yield7dAvgBps: BN,
  yield30dAvgBps: BN
): TransactionInstruction {
  const data = Buffer.alloc(34);
  data.writeUInt8(0x03, 0);
  currentYieldBps.toBuffer("le", 8).copy(data, 1);
  yieldMarkPriceE6.toBuffer("le", 8).copy(data, 9);
  data.writeUInt8(regime, 17);
  yield7dAvgBps.toBuffer("le", 8).copy(data, 18);
  yield30dAvgBps.toBuffer("le", 8).copy(data, 26);

  return new TransactionInstruction({
    programId: YIELD_MATCHER_PROGRAM_ID,
    keys: [
      {
        pubkey: matcherContext,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: ncnYieldFeed,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: ncnPerformanceFeed,
        isSigner: false,
        isWritable: false,
      },
    ],
    data,
  });
}

// ============================================================================
// Pricing Simulation (client-side)
// ============================================================================

export function simulateYieldExecPrice(
  ctx: YieldMatcherContext
): bigint {
  const regime = ctx.yieldRegime;
  const multipliers = [50n, 75n, 100n, 150n, 250n];
  const regimeMultiplier = multipliers[regime] ?? 100n;

  const adjustedYieldVol =
    (BigInt(ctx.yieldVolSpreadBps) * regimeMultiplier) / 100n;
  const totalSpread =
    BigInt(ctx.baseSpreadBps) + adjustedYieldVol <
    BigInt(ctx.maxSpreadBps)
      ? BigInt(ctx.baseSpreadBps) + adjustedYieldVol
      : BigInt(ctx.maxSpreadBps);

  return (ctx.yieldMarkPriceE6 * (10000n + totalSpread)) / 10000n;
}
