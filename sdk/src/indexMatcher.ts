/**
 * Index Matcher SDK — Interact with the index-matcher program
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  IndexMatcherContext,
  IndexMatcherMode,
  YieldRegime,
} from "./types";

const INDEX_MATCHER_MAGIC = BigInt("0x4944584D41544300"); // "IDXMATC\0"

const INDEX_MATCHER_PROGRAM_ID = new PublicKey(
  "iDXMtch111111111111111111111111111111111111"
);

// ============================================================================
// Context Deserialization (320-byte raw context account)
// ============================================================================

export function deserializeIndexMatcherContext(
  data: Buffer
): IndexMatcherContext {
  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  );

  return {
    magic: view.getBigUint64(64, true),
    version: view.getUint32(72, true),
    mode: data[76] as IndexMatcherMode,
    lpPda: new PublicKey(data.subarray(80, 112)),
    baseSpreadBps: view.getUint32(112, true),
    indexVolSpreadBps: view.getUint32(116, true),
    maxSpreadBps: view.getUint32(120, true),
    impactKBps: view.getUint32(124, true),
    weightedAvgApyBps: view.getBigUint64(128, true),
    indexMarkPriceE6: view.getBigUint64(136, true),
    lastUpdateSlot: view.getBigUint64(144, true),
    indexRegime: data[152] as YieldRegime,
    totalRestakedSol: view.getBigUint64(160, true),
    ncnCount: view.getUint32(168, true),
    minNcnCount: view.getUint32(172, true),
    liquidityNotionalE6: view.getBigUint64(176, true),
    maxFillAbs: view.getBigUint64(192, true),
    aggregatedFeed: new PublicKey(data.subarray(208, 240)),
  };
}

export async function fetchIndexMatcherContext(
  connection: Connection,
  address: PublicKey
): Promise<IndexMatcherContext | null> {
  const accountInfo = await connection.getAccountInfo(address);
  if (!accountInfo || accountInfo.data.length < 320) return null;
  return deserializeIndexMatcherContext(
    Buffer.from(accountInfo.data)
  );
}

// ============================================================================
// Instruction Builders
// ============================================================================

/** Build Init instruction (tag 0x02) */
export function buildIndexMatcherInitIx(
  lpPda: PublicKey,
  matcherContext: PublicKey,
  mode: IndexMatcherMode,
  baseSpreadBps: number,
  indexVolSpreadBps: number,
  maxSpreadBps: number,
  impactKBps: number,
  minNcnCount: number,
  liquidityNotionalE6: BN,
  maxFillAbs: BN,
  aggregatedFeed: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(86);
  data.writeUInt8(0x02, 0);
  data.writeUInt8(mode, 1);
  data.writeUInt32LE(baseSpreadBps, 2);
  data.writeUInt32LE(indexVolSpreadBps, 6);
  data.writeUInt32LE(maxSpreadBps, 10);
  data.writeUInt32LE(impactKBps, 14);
  data.writeUInt32LE(minNcnCount, 18);
  liquidityNotionalE6.toBuffer("le", 16).copy(data, 22);
  maxFillAbs.toBuffer("le", 16).copy(data, 38);
  aggregatedFeed.toBuffer().copy(data, 54);

  return new TransactionInstruction({
    programId: INDEX_MATCHER_PROGRAM_ID,
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
export function buildIndexMatcherMatchIx(
  lpPda: PublicKey,
  matcherContext: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(1);
  data.writeUInt8(0x00, 0);

  return new TransactionInstruction({
    programId: INDEX_MATCHER_PROGRAM_ID,
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

/** Build IndexSync instruction (tag 0x03) */
export function buildIndexSyncIx(
  matcherContext: PublicKey,
  aggregatedFeed: PublicKey,
  weightedAvgApyBps: BN,
  indexMarkPriceE6: BN,
  regime: number,
  totalRestakedSol: BN,
  ncnCount: number
): TransactionInstruction {
  const data = Buffer.alloc(30);
  data.writeUInt8(0x03, 0);
  weightedAvgApyBps.toBuffer("le", 8).copy(data, 1);
  indexMarkPriceE6.toBuffer("le", 8).copy(data, 9);
  data.writeUInt8(regime, 17);
  totalRestakedSol.toBuffer("le", 8).copy(data, 18);
  data.writeUInt32LE(ncnCount, 26);

  return new TransactionInstruction({
    programId: INDEX_MATCHER_PROGRAM_ID,
    keys: [
      {
        pubkey: matcherContext,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: aggregatedFeed,
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

export function simulateIndexExecPrice(
  ctx: IndexMatcherContext
): bigint {
  const regime = ctx.indexRegime;
  const multipliers = [50n, 75n, 100n, 150n, 250n];
  const regimeMultiplier = multipliers[regime] ?? 100n;

  const adjustedIndexVol =
    (BigInt(ctx.indexVolSpreadBps) * regimeMultiplier) / 100n;
  const totalSpread =
    BigInt(ctx.baseSpreadBps) + adjustedIndexVol <
    BigInt(ctx.maxSpreadBps)
      ? BigInt(ctx.baseSpreadBps) + adjustedIndexVol
      : BigInt(ctx.maxSpreadBps);

  return (ctx.indexMarkPriceE6 * (10000n + totalSpread)) / 10000n;
}
