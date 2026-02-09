/**
 * Simulation engine — auto-tick with mean-reverting noise,
 * random slashing events, signal detection, and regime reclassification.
 *
 * Ticks every 1.5s when running.
 */

import type { YieldRegime, SignalSeverity } from "./pricing";
import type { VigilState } from "./store";

/** Clamp a number between min and max */
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** Mean-reverting step: move `current` toward `target` with noise */
function meanRevert(current: number, target: number, speed: number, noise: number): number {
  const pull = (target - current) * speed;
  const jitter = (Math.random() - 0.5) * 2 * noise;
  return current + pull + jitter;
}

export function simulationTick(state: VigilState) {
  const preset = state.preset;

  // 1. Mean-revert uptime toward NCN baseline
  const currentUptimePct = Number(state.uptimeE6) / 10_000; // in percent (0-100)
  const baselineUptimePct = Number(preset.uptimeE6) / 10_000;
  const newUptimePct = clamp(
    meanRevert(currentUptimePct, baselineUptimePct, 0.15, 0.3),
    0.1,
    99.99,
  );
  const newUptimeE6 = BigInt(Math.round(newUptimePct * 10_000));
  const uptimeDelta = newUptimePct - currentUptimePct;

  // 2. Mean-revert yield toward NCN baseline
  const currentYieldBps = state.yieldBps;
  const baselineYieldBps = preset.yieldBps;
  const newYieldBps = clamp(
    Math.round(meanRevert(currentYieldBps, baselineYieldBps, 0.1, 15)),
    10,
    2000,
  );

  // 3. Random slashing event (~3% chance per tick)
  let slashing = false;
  if (Math.random() < 0.03) {
    slashing = true;
  }

  // 4. Signal detection (threshold checks)
  let newSignal: SignalSeverity = 0;
  if (newUptimePct < 95) {
    newSignal = 3; // CRITICAL
  } else if (newUptimePct < 97) {
    newSignal = 2; // HIGH
  } else if (newUptimePct < 99) {
    newSignal = 1; // LOW
  }

  // 5. Regime reclassification based on yield variance from baseline
  const yieldDeviation = Math.abs(newYieldBps - baselineYieldBps);
  let newRegime: YieldRegime = 2; // Normal
  if (yieldDeviation > 300) {
    newRegime = 4; // Extreme
  } else if (yieldDeviation > 150) {
    newRegime = 3; // High
  } else if (yieldDeviation > 50) {
    newRegime = 2; // Normal
  } else if (yieldDeviation > 20) {
    newRegime = 1; // Low
  } else {
    newRegime = 0; // VeryLow
  }

  // 6. Generate events
  state.advanceTick();

  if (slashing) {
    const slashedUptime = clamp(newUptimePct - 5, 0.1, 99.99);
    const slashedE6 = BigInt(Math.round(slashedUptime * 10_000));
    state.addEvent(
      `Slashing event! Uptime: ${newUptimePct.toFixed(1)}% → ${slashedUptime.toFixed(1)}%`,
      "critical",
    );
    state.setUptimePercent(slashedUptime);
    state.setSignal(3);
    state.setRegime(newRegime);
    state.setYieldBps(newYieldBps);
    return;
  }

  // Emit events for notable changes
  if (Math.abs(uptimeDelta) > 0.2) {
    state.addEvent(
      `Uptime drift: ${currentUptimePct.toFixed(1)}% → ${newUptimePct.toFixed(1)}%`,
      "info",
    );
  }

  if (newSignal !== state.signal && newSignal > 0) {
    const labels = ["NONE", "LOW", "HIGH", "CRITICAL"] as const;
    state.addEvent(
      `Signal → ${labels[newSignal]}, spread adjusted`,
      newSignal >= 2 ? "warning" : "info",
    );
  }

  if (newRegime !== state.regime) {
    const regimeLabels = ["VeryLow", "Low", "Normal", "High", "Extreme"];
    state.addEvent(
      `Yield regime: ${regimeLabels[state.regime]} → ${regimeLabels[newRegime]}`,
      newRegime >= 3 ? "warning" : "info",
    );
  }

  // Apply state
  state.setUptimePercent(newUptimePct);
  state.setYieldBps(newYieldBps);
  state.setSignal(newSignal);
  state.setRegime(newRegime);
}
