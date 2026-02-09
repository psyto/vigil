import { create } from "zustand";
import type { YieldRegime, SignalSeverity } from "./pricing";
import { NCN_PRESETS, type NcnPreset } from "./ncn-presets";

export interface TimelineEvent {
  id: number;
  tick: number;
  message: string;
  severity: "info" | "warning" | "critical";
}

export interface VigilState {
  // NCN selection
  ncnId: string;
  preset: NcnPreset;

  // Yield market
  yieldBps: number;          // 0-2000 (0-20%)
  yieldMarkE6: bigint;
  regime: YieldRegime;

  // Uptime market
  uptimeE6: bigint;          // 0-1_000_000
  signal: SignalSeverity;

  // Simulation
  running: boolean;
  tick: number;
  events: TimelineEvent[];
  eventCounter: number;

  // Actions
  selectNcn: (id: string) => void;
  setYieldBps: (bps: number) => void;
  setRegime: (r: YieldRegime) => void;
  setUptimePercent: (pct: number) => void;
  setSignal: (s: SignalSeverity) => void;
  toggleRunning: () => void;
  pause: () => void;
  addEvent: (message: string, severity: TimelineEvent["severity"]) => void;
  advanceTick: () => void;
  injectSlashing: () => void;
  reset: () => void;
}

const initial = NCN_PRESETS[0];

export const useVigilStore = create<VigilState>((set, get) => ({
  ncnId: initial.id,
  preset: initial,
  yieldBps: initial.yieldBps,
  yieldMarkE6: initial.yieldMarkE6,
  regime: initial.regime,
  uptimeE6: initial.uptimeE6,
  signal: initial.signal,
  running: false,
  tick: 0,
  events: [],
  eventCounter: 0,

  selectNcn: (id) => {
    const preset = NCN_PRESETS.find((p) => p.id === id) ?? NCN_PRESETS[0];
    set({
      ncnId: id,
      preset,
      yieldBps: preset.yieldBps,
      yieldMarkE6: preset.yieldMarkE6,
      regime: preset.regime,
      uptimeE6: preset.uptimeE6,
      signal: preset.signal,
      running: false,
      tick: 0,
      events: [],
      eventCounter: 0,
    });
  },

  setYieldBps: (bps) =>
    set({ yieldBps: bps, yieldMarkE6: BigInt(bps) * 1_000_000n }),

  setRegime: (r) => set({ regime: r }),

  setUptimePercent: (pct) =>
    set({ uptimeE6: BigInt(Math.round(pct * 10_000)) }),

  setSignal: (s) => set({ signal: s }),

  toggleRunning: () => set((s) => ({ running: !s.running })),

  pause: () => set({ running: false }),

  addEvent: (message, severity) =>
    set((s) => ({
      eventCounter: s.eventCounter + 1,
      events: [
        { id: s.eventCounter + 1, tick: s.tick, message, severity },
        ...s.events,
      ].slice(0, 50),
    })),

  advanceTick: () => set((s) => ({ tick: s.tick + 1 })),

  injectSlashing: () => {
    const s = get();
    set({
      uptimeE6: 0n,
      signal: 3,
      running: false,
    });
    s.addEvent("SLASHING EVENT! Uptime snapped to 0%", "critical");
  },

  reset: () => {
    const s = get();
    const preset = s.preset;
    set({
      yieldBps: preset.yieldBps,
      yieldMarkE6: preset.yieldMarkE6,
      regime: preset.regime,
      uptimeE6: preset.uptimeE6,
      signal: preset.signal,
      running: false,
      tick: 0,
      events: [],
      eventCounter: 0,
    });
  },
}));
