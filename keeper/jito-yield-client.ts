/**
 * Jito TipRouter Yield Client — Phase 2 real data source for restaking yields
 *
 * Replaces MockYieldSource with actual yield data from the Jito TipRouter API.
 * Decomposes yield into: base staking + MEV + restaking premium.
 *
 * Environment variables:
 *   JITO_TIPROUTER_URL  - API base URL (default: https://api.jito.network)
 *   JITO_API_KEY        - API key (optional)
 */

import { PublicKey } from "@solana/web3.js";
import { withRetry } from "./retry";

export interface YieldSnapshot {
  currentApyBps: number;
  baseStakingApyBps: number;
  mevApyBps: number;
  restakingPremiumBps: number;
  yieldVarianceBps: number;
  yield7dAvgBps: number;
  yield30dAvgBps: number;
}

export interface JitoYieldConfig {
  apiUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

/**
 * Real yield data source via Jito TipRouter API.
 *
 * Maintains a rolling history window for variance calculation
 * and falls back to last known good values on transient failures.
 */
export class JitoYieldClient {
  private config: JitoYieldConfig;
  private history: Map<string, number[]> = new Map();
  private lastKnownGood: Map<string, YieldSnapshot> = new Map();
  private readonly maxHistory = 168; // 7 days of hourly samples

  constructor(config?: Partial<JitoYieldConfig>) {
    this.config = {
      apiUrl: config?.apiUrl ?? process.env.JITO_TIPROUTER_URL ?? "https://api.jito.network",
      apiKey: config?.apiKey ?? process.env.JITO_API_KEY,
      timeoutMs: config?.timeoutMs ?? 10_000,
    };
  }

  /**
   * Fetch current yield data for an NCN.
   *
   * Returns decomposed yield data with variance calculated from
   * rolling history.
   */
  async fetchYield(ncnAddress: PublicKey): Promise<YieldSnapshot> {
    const key = ncnAddress.toBase58();

    try {
      const url = `${this.config.apiUrl}/v1/ncn/${key}/yield`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.config.apiKey) {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }

      const data = await withRetry(
        async () => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            this.config.timeoutMs,
          );
          try {
            const response = await fetch(url, {
              headers,
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
              throw new Error(`Jito API error: ${response.status} ${response.statusText}`);
            }
            return await response.json();
          } catch (err) {
            clearTimeout(timeout);
            throw err;
          }
        },
        { onRetry: (err, attempt, delay) => console.warn(`[JITO-YIELD] retry ${attempt} in ${delay}ms: ${err}`) },
      );

      // Jito returns APY as percentage (e.g., 8.5 for 8.5%)
      // Convert to basis points
      const currentApyBps = Math.round((data.apy ?? data.totalApy ?? 0) * 100);
      const baseStakingApyBps = Math.round((data.baseStakingApy ?? 0) * 100);
      const mevApyBps = Math.round((data.mevApy ?? data.tipApy ?? 0) * 100);
      const restakingPremiumBps = currentApyBps - baseStakingApyBps - mevApyBps;

      // Track history for variance calculation
      const hist = this.getHistory(key);
      hist.push(currentApyBps);
      if (hist.length > this.maxHistory) hist.shift();

      const snapshot: YieldSnapshot = {
        currentApyBps,
        baseStakingApyBps,
        mevApyBps,
        restakingPremiumBps: Math.max(0, restakingPremiumBps),
        yieldVarianceBps: this.computeVariance(hist),
        yield7dAvgBps: this.computeAvg(hist, 168),
        yield30dAvgBps: this.computeAvg(hist, hist.length),
      };

      this.lastKnownGood.set(key, snapshot);
      return snapshot;
    } catch (err) {
      console.warn(`[JITO-YIELD] Error fetching ${key}: ${err}`);

      // Fall back to last known good value
      const fallback = this.lastKnownGood.get(key);
      if (fallback) {
        console.warn(`[JITO-YIELD] Using last known good value for ${key}`);
        return fallback;
      }

      // No fallback - return zero yield
      return {
        currentApyBps: 0,
        baseStakingApyBps: 0,
        mevApyBps: 0,
        restakingPremiumBps: 0,
        yieldVarianceBps: 0,
        yield7dAvgBps: 0,
        yield30dAvgBps: 0,
      };
    }
  }

  private getHistory(key: string): number[] {
    let hist = this.history.get(key);
    if (!hist) {
      hist = [];
      this.history.set(key, hist);
    }
    return hist;
  }

  private computeVariance(history: number[]): number {
    if (history.length < 2) return 0;
    const avg = history.reduce((a, b) => a + b, 0) / history.length;
    const sumSqDiff = history.reduce(
      (sum, v) => sum + (v - avg) ** 2,
      0,
    );
    return Math.round(Math.sqrt(sumSqDiff / (history.length - 1)));
  }

  private computeAvg(history: number[], windowSize: number): number {
    const window = history.slice(-windowSize);
    if (window.length === 0) return 0;
    return Math.round(window.reduce((a, b) => a + b, 0) / window.length);
  }
}
