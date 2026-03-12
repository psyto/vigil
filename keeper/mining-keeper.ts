/**
 * Mining Keeper — Records LP participation and manages epochs
 *
 * Periodically reads matcher contexts to determine current regime,
 * then records regime-weighted participation for each registered LP.
 */

// ============================================================================
// Types
// ============================================================================

interface MockLpEntry {
  lpPda: string;
  matcherType: number; // 0=yield, 1=uptime, 2=index
  liquidity: number;
  accumulatedWeight: number;
  lastRecordSlot: number;
}

// ============================================================================
// Mock Mining Tracker
// ============================================================================

class MockMiningTracker {
  private lps: MockLpEntry[] = [];
  private currentSlot = 0;
  private totalWeight = 0;
  private currentEpoch = 0;
  private epochStartSlot = 0;
  private epochDurationSlots: number;
  private regimeMultipliers = [50, 75, 100, 200, 400]; // VeryLow..Extreme

  constructor(epochDurationSlots: number = 1000) {
    this.epochDurationSlots = epochDurationSlots;
  }

  registerLp(lpPda: string, matcherType: number, liquidity: number): void {
    this.lps.push({
      lpPda,
      matcherType,
      liquidity,
      accumulatedWeight: 0,
      lastRecordSlot: this.currentSlot,
    });
  }

  /** Record participation for all LPs given current regime */
  recordParticipation(currentRegime: number): void {
    this.currentSlot += 10; // Simulate slot advancement
    const multiplier = this.regimeMultipliers[currentRegime] ?? 100;

    for (const lp of this.lps) {
      const slotsElapsed = this.currentSlot - lp.lastRecordSlot;
      const weight = (lp.liquidity * multiplier * slotsElapsed) / 100;
      lp.accumulatedWeight += weight;
      this.totalWeight += weight;
      lp.lastRecordSlot = this.currentSlot;
    }
  }

  /** Check if epoch should be finalized */
  shouldFinalizeEpoch(): boolean {
    return this.currentSlot >= this.epochStartSlot + this.epochDurationSlots;
  }

  /** Finalize current epoch */
  finalizeEpoch(): { epoch: number; totalWeight: number } | null {
    if (!this.shouldFinalizeEpoch()) return null;

    const result = {
      epoch: this.currentEpoch,
      totalWeight: this.totalWeight,
    };

    // Reset for next epoch
    this.currentEpoch++;
    this.epochStartSlot = this.currentSlot;
    this.totalWeight = 0;
    for (const lp of this.lps) {
      lp.accumulatedWeight = 0;
    }

    return result;
  }

  getLps(): MockLpEntry[] {
    return this.lps;
  }

  getCurrentEpoch(): number {
    return this.currentEpoch;
  }
}

// ============================================================================
// Runner
// ============================================================================

const MATCHER_TYPE_NAMES = ["Yield", "Uptime", "Index"] as const;
const REGIME_NAMES = ["VeryLow", "Low", "Normal", "High", "Extreme"] as const;

function runMiningKeeper(intervalMs: number = 10_000) {
  const tracker = new MockMiningTracker(100);

  // Register some mock LPs
  tracker.registerLp("lp-yield-1", 0, 1_000_000);
  tracker.registerLp("lp-uptime-1", 1, 500_000);
  tracker.registerLp("lp-index-1", 2, 2_000_000);

  console.log("[MINING] Starting mining keeper (mock mode)");
  console.log(`[MINING] Registered ${tracker.getLps().length} LPs`);

  const tick = () => {
    // Simulate regime (mostly Normal with occasional High)
    const regime = Math.random() > 0.85 ? 3 : 2;

    tracker.recordParticipation(regime);

    const lps = tracker.getLps();
    for (const lp of lps) {
      console.log(
        `[MINING]   ${lp.lpPda.padEnd(14)} type=${MATCHER_TYPE_NAMES[lp.matcherType]}  weight=${Math.round(lp.accumulatedWeight)}  regime=${REGIME_NAMES[regime]}`
      );
    }

    // Check epoch finalization
    const result = tracker.finalizeEpoch();
    if (result) {
      console.log(
        `[MINING] *** Epoch ${result.epoch} finalized — total_weight=${Math.round(result.totalWeight)} ***`
      );
    }
  };

  tick();
  setInterval(tick, intervalMs);
}

export { MockMiningTracker, runMiningKeeper };
export type { MockLpEntry };
