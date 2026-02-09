/**
 * NCN Oracle SDK — Read NCN oracle accounts
 */

import { Connection, PublicKey } from "@solana/web3.js";
import {
  NcnPerformanceFeedData,
  NcnPerformanceSample,
  NcnYieldFeedData,
  YieldSample,
  YieldRegime,
  AggregatedRestakingFeedData,
} from "./types";

const NCN_ORACLE_PROGRAM_ID = new PublicKey(
  "NCNRsk1111111111111111111111111111111111111"
);

// ============================================================================
// PDA Derivation
// ============================================================================

export function deriveNcnPerformanceFeedPda(
  ncnAddress: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ncn_perf_feed"), ncnAddress.toBuffer()],
    NCN_ORACLE_PROGRAM_ID
  );
}

export function deriveNcnYieldFeedPda(
  ncnAddress: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ncn_yield_feed"), ncnAddress.toBuffer()],
    NCN_ORACLE_PROGRAM_ID
  );
}

export function deriveAggregatedFeedPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("aggregated_restaking_feed")],
    NCN_ORACLE_PROGRAM_ID
  );
}

// ============================================================================
// Account Deserialization
// ============================================================================

export async function fetchNcnPerformanceFeed(
  connection: Connection,
  address: PublicKey
): Promise<NcnPerformanceFeedData | null> {
  const accountInfo = await connection.getAccountInfo(address);
  if (!accountInfo) return null;

  // Skip 8-byte Anchor discriminator
  const data = accountInfo.data.subarray(8);
  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  );

  let offset = 0;

  const authority = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const ncnAddress = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // String: 4-byte length prefix + UTF-8 bytes
  const nameLen = view.getUint32(offset, true);
  offset += 4;
  const ncnName = new TextDecoder().decode(
    data.subarray(offset, offset + nameLen)
  );
  offset += nameLen;

  const uptimeProbabilityE6 = view.getBigUint64(offset, true);
  offset += 8;

  const totalSlashingEvents = view.getUint32(offset, true);
  offset += 4;

  const lastSlashingTime = view.getBigInt64(offset, true);
  offset += 8;

  const totalRestakedSol = view.getBigUint64(offset, true);
  offset += 8;

  const restakerCount = view.getUint32(offset, true);
  offset += 4;

  // Vec<NcnPerformanceSample>: 4-byte length + items
  const historyLen = view.getUint32(offset, true);
  offset += 4;
  const performanceHistory: NcnPerformanceSample[] = [];
  for (let i = 0; i < historyLen; i++) {
    const uptimeE6 = view.getBigUint64(offset, true);
    offset += 8;
    const restaked = view.getBigUint64(offset, true);
    offset += 8;
    const count = view.getUint32(offset, true);
    offset += 4;
    const timestamp = view.getBigInt64(offset, true);
    offset += 8;
    performanceHistory.push({
      uptimeE6,
      totalRestakedSol: restaked,
      restakerCount: count,
      timestamp,
    });
  }

  const signalSeverity = data[offset];
  offset += 1;

  const sovereignInfraScore = view.getUint16(offset, true);
  offset += 2;

  const isActive = data[offset] === 1;
  offset += 1;

  const lastUpdated = view.getBigInt64(offset, true);
  offset += 8;

  return {
    authority,
    ncnAddress,
    ncnName,
    uptimeProbabilityE6,
    totalSlashingEvents,
    lastSlashingTime,
    totalRestakedSol,
    restakerCount,
    performanceHistory,
    signalSeverity,
    sovereignInfraScore,
    isActive,
    lastUpdated,
  };
}

export async function fetchNcnYieldFeed(
  connection: Connection,
  address: PublicKey
): Promise<NcnYieldFeedData | null> {
  const accountInfo = await connection.getAccountInfo(address);
  if (!accountInfo) return null;

  const data = accountInfo.data.subarray(8);
  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  );

  let offset = 0;

  const authority = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const ncnAddress = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const currentApyBps = view.getBigUint64(offset, true);
  offset += 8;
  const apy7dAvg = view.getBigUint64(offset, true);
  offset += 8;
  const apy30dAvg = view.getBigUint64(offset, true);
  offset += 8;
  const yieldVarianceBps = view.getBigUint64(offset, true);
  offset += 8;
  const yieldRegime = data[offset] as YieldRegime;
  offset += 1;

  // Vec<YieldSample>
  const historyLen = view.getUint32(offset, true);
  offset += 4;
  const yieldHistory: YieldSample[] = [];
  for (let i = 0; i < historyLen; i++) {
    const apyBps = view.getBigUint64(offset, true);
    offset += 8;
    const varianceBps = view.getBigUint64(offset, true);
    offset += 8;
    const timestamp = view.getBigInt64(offset, true);
    offset += 8;
    yieldHistory.push({ apyBps, varianceBps, timestamp });
  }

  const baseStakingApyBps = view.getBigUint64(offset, true);
  offset += 8;
  const mevApyBps = view.getBigUint64(offset, true);
  offset += 8;
  const restakingPremiumBps = view.getBigUint64(offset, true);
  offset += 8;

  const isActive = data[offset] === 1;
  offset += 1;
  const lastUpdated = view.getBigInt64(offset, true);
  offset += 8;

  return {
    authority,
    ncnAddress,
    currentApyBps,
    apy7dAvg,
    apy30dAvg,
    yieldVarianceBps,
    yieldRegime,
    yieldHistory,
    baseStakingApyBps,
    mevApyBps,
    restakingPremiumBps,
    isActive,
    lastUpdated,
  };
}

export async function fetchAggregatedRestakingFeed(
  connection: Connection,
  address: PublicKey
): Promise<AggregatedRestakingFeedData | null> {
  const accountInfo = await connection.getAccountInfo(address);
  if (!accountInfo) return null;

  const data = accountInfo.data.subarray(8);
  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  );

  let offset = 0;

  const authority = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const totalRestakedSol = view.getBigUint64(offset, true);
  offset += 8;
  const weightedAvgApyBps = view.getBigUint64(offset, true);
  offset += 8;
  const ncnCount = view.getUint32(offset, true);
  offset += 4;

  // Vec<Pubkey>
  const feedsLen = view.getUint32(offset, true);
  offset += 4;
  const ncnFeeds: PublicKey[] = [];
  for (let i = 0; i < feedsLen; i++) {
    ncnFeeds.push(new PublicKey(data.subarray(offset, offset + 32)));
    offset += 32;
  }

  const isActive = data[offset] === 1;
  offset += 1;
  const lastUpdated = view.getBigInt64(offset, true);
  offset += 8;

  return {
    authority,
    totalRestakedSol,
    weightedAvgApyBps,
    ncnCount,
    ncnFeeds,
    isActive,
    lastUpdated,
  };
}
