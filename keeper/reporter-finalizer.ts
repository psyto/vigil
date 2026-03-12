/**
 * Reporter Finalizer — Monitors pending submissions and finalizes rounds
 * when enough reporters have submitted data.
 *
 * In Phase 1 (mock mode), simulates the multi-reporter flow.
 */

// ============================================================================
// Types
// ============================================================================

interface MockReporterSubmission {
  reporter: string;
  uptimeE6: number;
  totalRestakedSol: number;
  restakerCount: number;
  currentApyBps: number;
  timestamp: number;
}

interface MockPendingRound {
  ncnAddress: string;
  round: number;
  submissions: MockReporterSubmission[];
  isFinalized: boolean;
  finalizedUptimeE6: number;
  finalizedApyBps: number;
}

// ============================================================================
// Reporter Finalizer
// ============================================================================

class ReporterFinalizer {
  private rounds = new Map<string, MockPendingRound>();
  private currentRound = 0;
  private minReporters: number;

  constructor(minReporters: number = 3) {
    this.minReporters = minReporters;
  }

  /** Simulate a reporter submission */
  submitReport(
    ncnAddress: string,
    reporter: string,
    uptimeE6: number,
    totalRestakedSol: number,
    restakerCount: number,
    currentApyBps: number
  ): void {
    const key = `${ncnAddress}:${this.currentRound}`;
    let round = this.rounds.get(key);
    if (!round) {
      round = {
        ncnAddress,
        round: this.currentRound,
        submissions: [],
        isFinalized: false,
        finalizedUptimeE6: 0,
        finalizedApyBps: 0,
      };
      this.rounds.set(key, round);
    }

    if (round.isFinalized) return;
    if (round.submissions.some((s) => s.reporter === reporter)) return;

    round.submissions.push({
      reporter,
      uptimeE6,
      totalRestakedSol,
      restakerCount,
      currentApyBps,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  /** Check if any rounds can be finalized */
  tryFinalize(ncnAddress: string): MockPendingRound | null {
    const key = `${ncnAddress}:${this.currentRound}`;
    const round = this.rounds.get(key);
    if (!round || round.isFinalized) return null;
    if (round.submissions.length < this.minReporters) return null;

    // Compute medians
    const uptimes = round.submissions.map((s) => s.uptimeE6).sort((a, b) => a - b);
    const apys = round.submissions.map((s) => s.currentApyBps).sort((a, b) => a - b);

    const median = (arr: number[]) => {
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 === 0 ? Math.floor((arr[mid - 1] + arr[mid]) / 2) : arr[mid];
    };

    round.finalizedUptimeE6 = median(uptimes);
    round.finalizedApyBps = median(apys);
    round.isFinalized = true;

    return round;
  }

  /** Advance to next round */
  advanceRound(): void {
    this.currentRound++;
  }

  getCurrentRound(): number {
    return this.currentRound;
  }
}

// ============================================================================
// Runner
// ============================================================================

function runReporterFinalizer(
  ncnAddresses: string[],
  minReporters: number = 3,
  intervalMs: number = 10_000
) {
  const finalizer = new ReporterFinalizer(minReporters);
  const mockReporters = ["reporter-A", "reporter-B", "reporter-C", "reporter-D"];

  console.log("[FINALIZER] Starting reporter finalizer (mock mode)");
  console.log(`[FINALIZER] Min reporters: ${minReporters}`);

  const tick = () => {
    for (const ncn of ncnAddresses) {
      // Simulate reporters submitting with slight variance
      for (const reporter of mockReporters.slice(0, minReporters + 1)) {
        const baseUptime = 995_000;
        const baseApy = 800;
        const uptimeNoise = Math.round((Math.random() - 0.5) * 2000);
        const apyNoise = Math.round((Math.random() - 0.5) * 20);

        finalizer.submitReport(
          ncn,
          reporter,
          baseUptime + uptimeNoise,
          Math.round(500_000 * 1e9),
          1200,
          baseApy + apyNoise
        );
      }

      const result = finalizer.tryFinalize(ncn);
      if (result) {
        const uptimePct = (result.finalizedUptimeE6 / 10_000).toFixed(2);
        const apyPct = (result.finalizedApyBps / 100).toFixed(2);
        console.log(
          `[FINALIZER] Round ${result.round} finalized for ${ncn.slice(0, 8)}... — uptime=${uptimePct}% APY=${apyPct}% (${result.submissions.length} reporters)`
        );
      }
    }

    finalizer.advanceRound();
  };

  tick();
  setInterval(tick, intervalMs);
}

export { ReporterFinalizer, runReporterFinalizer };
export type { MockPendingRound, MockReporterSubmission };
