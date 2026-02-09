import type { YieldRegime, SignalSeverity } from "./pricing";

export interface NcnPreset {
  id: string;
  name: string;
  description: string;
  uptimeE6: bigint;       // e.g. 998_000 = 99.8%
  yieldBps: number;       // e.g. 800 = 8.0%
  yieldMarkE6: bigint;    // yieldBps * 1e4 = 8_000_000
  regime: YieldRegime;
  signal: SignalSeverity;
  // Spread params (shared across NCNs for demo simplicity)
  baseSpreadBps: bigint;
  yieldVolSpreadBps: bigint;
  maxYieldSpreadBps: bigint;
  edgeSpreadBps: bigint;
  maxUptimeSpreadBps: bigint;
}

export const NCN_PRESETS: NcnPreset[] = [
  {
    id: "pyth",
    name: "Pyth Oracle",
    description: "High-reliability oracle network",
    uptimeE6: 998_000n,
    yieldBps: 800,
    yieldMarkE6: 800_000_000n,
    regime: 2, // Normal
    signal: 0,
    baseSpreadBps: 20n,
    yieldVolSpreadBps: 30n,
    maxYieldSpreadBps: 200n,
    edgeSpreadBps: 30n,
    maxUptimeSpreadBps: 500n,
  },
  {
    id: "wormhole",
    name: "Wormhole Bridge",
    description: "Higher risk, higher yield bridge",
    uptimeE6: 995_000n,
    yieldBps: 1200,
    yieldMarkE6: 1_200_000_000n,
    regime: 3, // High
    signal: 0,
    baseSpreadBps: 20n,
    yieldVolSpreadBps: 30n,
    maxYieldSpreadBps: 200n,
    edgeSpreadBps: 30n,
    maxUptimeSpreadBps: 500n,
  },
  {
    id: "jito",
    name: "Jito MEV",
    description: "Largest, most stable MEV network",
    uptimeE6: 999_000n,
    yieldBps: 600,
    yieldMarkE6: 600_000_000n,
    regime: 0, // VeryLow
    signal: 0,
    baseSpreadBps: 20n,
    yieldVolSpreadBps: 30n,
    maxYieldSpreadBps: 200n,
    edgeSpreadBps: 30n,
    maxUptimeSpreadBps: 500n,
  },
];

export function getPreset(id: string): NcnPreset {
  return NCN_PRESETS.find((p) => p.id === id) ?? NCN_PRESETS[0];
}
