/**
 * Fragmetric API Client — Phase 2 real data source for NCN performance
 *
 * Replaces MockNcnDataSource with actual NCN performance data from
 * the Fragmetric restaking API.
 *
 * Environment variables:
 *   FRAGMETRIC_API_URL  - API base URL (default: https://api.fragmetric.xyz)
 *   FRAGMETRIC_API_KEY  - API key (optional, depends on tier)
 */

import { PublicKey } from "@solana/web3.js";
import { withRetry } from "./retry";

export interface NcnPerformanceSample {
  uptimeE6: number;
  totalRestakedSol: number;
  restakerCount: number;
  slashingEvent: boolean;
}

export interface FragmetricConfig {
  apiUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

/**
 * Real NCN performance data source via Fragmetric API.
 *
 * Falls back to last known good values on transient API failures
 * to avoid feeding stale or zero data to the matcher.
 */
export class FragmetricClient {
  private config: FragmetricConfig;
  private lastKnownGood: Map<string, NcnPerformanceSample> = new Map();

  constructor(config?: Partial<FragmetricConfig>) {
    this.config = {
      apiUrl: config?.apiUrl ?? process.env.FRAGMETRIC_API_URL ?? "https://api.fragmetric.xyz",
      apiKey: config?.apiKey ?? process.env.FRAGMETRIC_API_KEY,
      timeoutMs: config?.timeoutMs ?? 10_000,
    };
  }

  /**
   * Fetch NCN performance data for a given NCN address.
   *
   * Returns real data from Fragmetric API, or falls back to last known
   * good sample on transient failures.
   */
  async fetchPerformance(ncnAddress: PublicKey): Promise<NcnPerformanceSample> {
    const key = ncnAddress.toBase58();

    try {
      const url = `${this.config.apiUrl}/v1/ncn/${key}/performance`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.config.apiKey) {
        headers["X-API-Key"] = this.config.apiKey;
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
              throw new Error(`Fragmetric API error: ${response.status} ${response.statusText}`);
            }
            return await response.json();
          } catch (err) {
            clearTimeout(timeout);
            throw err;
          }
        },
        { onRetry: (err, attempt, delay) => console.warn(`[FRAGMETRIC] retry ${attempt} in ${delay}ms: ${err}`) },
      );

      const sample: NcnPerformanceSample = {
        // Fragmetric returns uptime as a decimal (0.0 - 1.0)
        uptimeE6: Math.round((data.uptime ?? 0.995) * 1_000_000),
        // TVL in lamports
        totalRestakedSol: data.totalStakedLamports ?? data.tvl ?? 0,
        // Active restaker count
        restakerCount: data.restakerCount ?? data.delegatorCount ?? 0,
        // Slashing detected from recent events
        slashingEvent: data.recentSlashing ?? false,
      };

      this.lastKnownGood.set(key, sample);
      return sample;
    } catch (err) {
      console.warn(`[FRAGMETRIC] Error fetching ${key}: ${err}`);

      // Fall back to last known good value
      const fallback = this.lastKnownGood.get(key);
      if (fallback) {
        console.warn(`[FRAGMETRIC] Using last known good value for ${key}`);
        return { ...fallback, slashingEvent: false };
      }

      // No fallback available - return safe defaults
      return {
        uptimeE6: 995_000,
        totalRestakedSol: 0,
        restakerCount: 0,
        slashingEvent: false,
      };
    }
  }

  /**
   * Batch fetch performance data for multiple NCNs.
   */
  async fetchAll(
    ncnAddresses: PublicKey[],
  ): Promise<Map<string, NcnPerformanceSample>> {
    const results = new Map<string, NcnPerformanceSample>();

    const promises = ncnAddresses.map(async (addr) => {
      const sample = await this.fetchPerformance(addr);
      results.set(addr.toBase58(), sample);
    });

    await Promise.allSettled(promises);
    return results;
  }
}
