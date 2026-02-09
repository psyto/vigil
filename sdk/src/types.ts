/**
 * Shared types for the vigil SDK
 */

import { PublicKey } from "@solana/web3.js";

// ============================================================================
// NCN Oracle Types
// ============================================================================

export interface NcnPerformanceFeedData {
  authority: PublicKey;
  ncnAddress: PublicKey;
  ncnName: string;
  uptimeProbabilityE6: bigint;
  totalSlashingEvents: number;
  lastSlashingTime: bigint;
  totalRestakedSol: bigint;
  restakerCount: number;
  performanceHistory: NcnPerformanceSample[];
  signalSeverity: number;
  sovereignInfraScore: number;
  isActive: boolean;
  lastUpdated: bigint;
}

export interface NcnPerformanceSample {
  uptimeE6: bigint;
  totalRestakedSol: bigint;
  restakerCount: number;
  timestamp: bigint;
}

export interface NcnYieldFeedData {
  authority: PublicKey;
  ncnAddress: PublicKey;
  currentApyBps: bigint;
  apy7dAvg: bigint;
  apy30dAvg: bigint;
  yieldVarianceBps: bigint;
  yieldRegime: YieldRegime;
  yieldHistory: YieldSample[];
  baseStakingApyBps: bigint;
  mevApyBps: bigint;
  restakingPremiumBps: bigint;
  isActive: boolean;
  lastUpdated: bigint;
}

export interface YieldSample {
  apyBps: bigint;
  varianceBps: bigint;
  timestamp: bigint;
}

export interface AggregatedRestakingFeedData {
  authority: PublicKey;
  totalRestakedSol: bigint;
  weightedAvgApyBps: bigint;
  ncnCount: number;
  ncnFeeds: PublicKey[];
  isActive: boolean;
  lastUpdated: bigint;
}

// ============================================================================
// Yield Matcher Types
// ============================================================================

export enum YieldRegime {
  VeryLow = 0,
  Low = 1,
  Normal = 2,
  High = 3,
  Extreme = 4,
}

export interface YieldMatcherContext {
  magic: bigint;
  version: number;
  mode: YieldMatcherMode;
  lpPda: PublicKey;
  baseSpreadBps: number;
  yieldVolSpreadBps: number;
  maxSpreadBps: number;
  impactKBps: number;
  currentYieldBps: bigint;
  yieldMarkPriceE6: bigint;
  lastUpdateSlot: bigint;
  yieldRegime: YieldRegime;
  yield7dAvgBps: bigint;
  yield30dAvgBps: bigint;
  liquidityNotionalE6: bigint;
  maxFillAbs: bigint;
  ncnYieldFeed: PublicKey;
  ncnPerformanceFeed: PublicKey;
}

export enum YieldMatcherMode {
  AllNCN = 0,
  SingleNCN = 1,
}

// ============================================================================
// Uptime Matcher Types
// ============================================================================

export interface UptimeMatcherContext {
  magic: bigint;
  version: number;
  mode: UptimeMatcherMode;
  lpPda: PublicKey;
  baseSpreadBps: number;
  edgeSpreadBps: number;
  maxSpreadBps: number;
  impactKBps: number;
  currentUptimeE6: bigint;
  uptimeMarkE6: bigint;
  lastUpdateSlot: bigint;
  resolutionTimestamp: bigint;
  isResolved: boolean;
  resolutionOutcome: ResolutionOutcome;
  signalSeverity: bigint;
  signalAdjustedSpread: bigint;
  liquidityNotionalE6: bigint;
  maxFillAbs: bigint;
  ncnOracle: PublicKey;
}

export enum UptimeMatcherMode {
  Continuous = 0,
  SlashingSettlement = 1,
}

export enum ResolutionOutcome {
  Slashed = 0,
  Safe = 1,
}

// ============================================================================
// Signal Types
// ============================================================================

export enum SignalSeverity {
  None = 0,
  Low = 1,
  High = 2,
  Critical = 3,
}

// ============================================================================
// Market Types
// ============================================================================

export interface RestakingMarket {
  marketType: "yield" | "uptime";
  ncnName: string;
  ncnAddress: PublicKey;
  matcherContext: PublicKey;
  currentValue: string; // human-readable APY% or uptime%
  regime?: string;
  signalSeverity?: string;
  isResolved?: boolean;
}
