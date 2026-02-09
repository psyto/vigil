/**
 * Uptime Matcher SDK — Interact with the ncn-uptime-matcher program
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  UptimeMatcherContext,
  UptimeMatcherMode,
  ResolutionOutcome,
} from "./types";

const UPTIME_MATCHER_MAGIC = BigInt("0x4e434e554d415443"); // "NCNUMATC"

const UPTIME_MATCHER_PROGRAM_ID = new PublicKey(
  "UPTMtch111111111111111111111111111111111111"
);

// ============================================================================
// Context Deserialization (320-byte raw context account)
// ============================================================================

export function deserializeUptimeMatcherContext(
  data: Buffer
): UptimeMatcherContext {
  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  );

  return {
    magic: view.getBigUint64(64, true),
    version: view.getUint32(72, true),
    mode: data[76] as UptimeMatcherMode,
    lpPda: new PublicKey(data.subarray(80, 112)),
    baseSpreadBps: view.getUint32(112, true),
    edgeSpreadBps: view.getUint32(116, true),
    maxSpreadBps: view.getUint32(120, true),
    impactKBps: view.getUint32(124, true),
    currentUptimeE6: view.getBigUint64(128, true),
    uptimeMarkE6: view.getBigUint64(136, true),
    lastUpdateSlot: view.getBigUint64(144, true),
    resolutionTimestamp: view.getBigInt64(152, true),
    isResolved: data[160] === 1,
    resolutionOutcome: data[161] as ResolutionOutcome,
    signalSeverity: view.getBigUint64(168, true),
    signalAdjustedSpread: view.getBigUint64(176, true),
    liquidityNotionalE6: view.getBigUint64(184, true),
    maxFillAbs: view.getBigUint64(200, true),
    ncnOracle: new PublicKey(data.subarray(216, 248)),
  };
}

export async function fetchUptimeMatcherContext(
  connection: Connection,
  address: PublicKey
): Promise<UptimeMatcherContext | null> {
  const accountInfo = await connection.getAccountInfo(address);
  if (!accountInfo || accountInfo.data.length < 320) return null;
  return deserializeUptimeMatcherContext(
    Buffer.from(accountInfo.data)
  );
}

// ============================================================================
// Instruction Builders
// ============================================================================

/** Build Init instruction (tag 0x02) */
export function buildUptimeMatcherInitIx(
  lpPda: PublicKey,
  matcherContext: PublicKey,
  mode: UptimeMatcherMode,
  baseSpreadBps: number,
  edgeSpreadBps: number,
  maxSpreadBps: number,
  impactKBps: number,
  initialUptimeE6: BN,
  resolutionTimestamp: BN,
  liquidityNotionalE6: BN,
  maxFillAbs: BN,
  ncnOracle: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(98);
  data.writeUInt8(0x02, 0);
  data.writeUInt8(mode, 1);
  data.writeUInt32LE(baseSpreadBps, 2);
  data.writeUInt32LE(edgeSpreadBps, 6);
  data.writeUInt32LE(maxSpreadBps, 10);
  data.writeUInt32LE(impactKBps, 14);
  initialUptimeE6.toBuffer("le", 8).copy(data, 18);
  resolutionTimestamp.toBuffer("le", 8).copy(data, 26);
  liquidityNotionalE6.toBuffer("le", 16).copy(data, 34);
  maxFillAbs.toBuffer("le", 16).copy(data, 50);
  ncnOracle.toBuffer().copy(data, 66);

  return new TransactionInstruction({
    programId: UPTIME_MATCHER_PROGRAM_ID,
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
export function buildUptimeMatcherMatchIx(
  lpPda: PublicKey,
  matcherContext: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(1);
  data.writeUInt8(0x00, 0);

  return new TransactionInstruction({
    programId: UPTIME_MATCHER_PROGRAM_ID,
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

/** Build UptimeSync instruction (tag 0x03) */
export function buildUptimeSyncIx(
  matcherContext: PublicKey,
  ncnOracle: PublicKey,
  newUptimeE6: BN,
  signalSeverity: BN,
  signalAdjustedSpread: BN
): TransactionInstruction {
  const data = Buffer.alloc(25);
  data.writeUInt8(0x03, 0);
  newUptimeE6.toBuffer("le", 8).copy(data, 1);
  signalSeverity.toBuffer("le", 8).copy(data, 9);
  signalAdjustedSpread.toBuffer("le", 8).copy(data, 17);

  return new TransactionInstruction({
    programId: UPTIME_MATCHER_PROGRAM_ID,
    keys: [
      {
        pubkey: matcherContext,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: ncnOracle, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** Build Resolve instruction (tag 0x04) */
export function buildResolveIx(
  matcherContext: PublicKey,
  ncnOracle: PublicKey,
  outcome: ResolutionOutcome
): TransactionInstruction {
  const data = Buffer.alloc(2);
  data.writeUInt8(0x04, 0);
  data.writeUInt8(outcome, 1);

  return new TransactionInstruction({
    programId: UPTIME_MATCHER_PROGRAM_ID,
    keys: [
      {
        pubkey: matcherContext,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: ncnOracle, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// ============================================================================
// Pricing Simulation (client-side)
// ============================================================================

export function simulateUptimeExecPrice(
  ctx: UptimeMatcherContext
): bigint {
  const p = ctx.currentUptimeE6;
  const oneMinusP = 1_000_000n - p;

  const edgeDenominator = (p * oneMinusP * 4n) / 1_000_000_000_000n;

  let edgeFactor: bigint;
  if (edgeDenominator > 0n) {
    const raw = 1_000_000n / edgeDenominator;
    edgeFactor = raw < 10_000_000n ? raw : 10_000_000n;
  } else {
    edgeFactor = 10_000_000n;
  }

  const adjustedEdge =
    (BigInt(ctx.edgeSpreadBps) * edgeFactor) / 1_000_000n;

  let totalSpread =
    BigInt(ctx.baseSpreadBps) +
    adjustedEdge +
    ctx.signalAdjustedSpread;
  if (totalSpread > BigInt(ctx.maxSpreadBps)) {
    totalSpread = BigInt(ctx.maxSpreadBps);
  }

  return (p * (10_000n + totalSpread)) / 10_000n;
}
