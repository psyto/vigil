"use client";

import { useMemo } from "react";
import * as Slider from "@radix-ui/react-slider";
import * as Select from "@radix-ui/react-select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ChevronDown } from "lucide-react";
import { useVigilStore } from "@/lib/store";
import {
  computeYieldPrice,
  yieldSpreadByRegime,
  REGIME_LABELS,
  type YieldRegime,
} from "@/lib/pricing";

const REGIMES: YieldRegime[] = [0, 1, 2, 3, 4];
const REGIME_COLORS: Record<number, string> = {
  0: "#22c55e",
  1: "#86efac",
  2: "#6366f1",
  3: "#eab308",
  4: "#ef4444",
};

export function YieldMarketPanel() {
  const yieldBps = useVigilStore((s) => s.yieldBps);
  const yieldMarkE6 = useVigilStore((s) => s.yieldMarkE6);
  const regime = useVigilStore((s) => s.regime);
  const preset = useVigilStore((s) => s.preset);
  const setYieldBps = useVigilStore((s) => s.setYieldBps);
  const setRegime = useVigilStore((s) => s.setRegime);

  const pricing = useMemo(
    () =>
      computeYieldPrice({
        baseSpreadBps: preset.baseSpreadBps,
        yieldVolSpreadBps: preset.yieldVolSpreadBps,
        maxSpreadBps: preset.maxYieldSpreadBps,
        regime,
        yieldMarkPriceE6: yieldMarkE6,
      }),
    [yieldMarkE6, regime, preset],
  );

  const chartData = useMemo(
    () =>
      yieldSpreadByRegime(
        preset.baseSpreadBps,
        preset.yieldVolSpreadBps,
        preset.maxYieldSpreadBps,
      ),
    [preset],
  );

  const yieldPct = (yieldBps / 100).toFixed(1);
  const execPricePct = (Number(pricing.execPrice) / 1e7).toFixed(2);

  return (
    <div className="bg-vigil-surface border border-vigil-border rounded-xl p-5 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-vigil-accent uppercase tracking-wider">
        Yield Market
      </h2>

      {/* APY Slider */}
      <div>
        <div className="flex justify-between text-xs text-vigil-muted mb-2">
          <span>APY</span>
          <span className="text-white font-mono">{yieldPct}%</span>
        </div>
        <Slider.Root
          className="relative flex items-center w-full h-5 select-none touch-none"
          value={[yieldBps]}
          onValueChange={([v]) => setYieldBps(v)}
          min={0}
          max={2000}
          step={10}
        >
          <Slider.Track className="relative grow h-1 rounded-full bg-vigil-border">
            <Slider.Range className="absolute h-full rounded-full bg-vigil-accent" />
          </Slider.Track>
          <Slider.Thumb className="block w-4 h-4 rounded-full bg-vigil-accent border-2 border-vigil-bg focus:outline-none focus:ring-2 focus:ring-vigil-accent/30" />
        </Slider.Root>
      </div>

      {/* Regime Selector */}
      <div>
        <div className="text-xs text-vigil-muted mb-1">Regime</div>
        <Select.Root
          value={String(regime)}
          onValueChange={(v) => setRegime(Number(v) as YieldRegime)}
        >
          <Select.Trigger className="inline-flex items-center gap-2 px-3 py-1.5 bg-vigil-bg border border-vigil-border rounded-lg text-sm w-full justify-between">
            <Select.Value />
            <Select.Icon>
              <ChevronDown className="w-3 h-3 text-vigil-muted" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="bg-vigil-surface border border-vigil-border rounded-lg shadow-xl overflow-hidden z-50">
              <Select.Viewport className="p-1">
                {REGIMES.map((r) => (
                  <Select.Item
                    key={r}
                    value={String(r)}
                    className="px-3 py-1.5 text-sm rounded cursor-pointer outline-none data-[highlighted]:bg-vigil-accent/20 data-[highlighted]:text-white"
                  >
                    <Select.ItemText>{REGIME_LABELS[r]}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      {/* Pricing breakdown */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <PricingRow label="Regime Mult" value={`${(Number(pricing.regimeMultiplier) / 100).toFixed(2)}x`} />
        <PricingRow label="Adj Vol Spread" value={String(pricing.adjustedYieldVol)} />
        <PricingRow label="Total Spread" value={`${pricing.totalSpread} bps`} />
        <PricingRow
          label="Exec Price"
          value={`${execPricePct}%`}
          highlight
        />
      </div>

      {/* Bar chart: spread by regime */}
      <div className="h-40 mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
            <XAxis
              dataKey="regime"
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={{ stroke: "#1e1e2e" }}
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={{ stroke: "#1e1e2e" }}
              label={{ value: "bps", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                background: "#12121a",
                border: "1px solid #1e1e2e",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Bar dataKey="spread" radius={[4, 4, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={REGIME_COLORS[i]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PricingRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-1 px-2 rounded bg-vigil-bg/50">
      <span className="text-vigil-muted">{label}</span>
      <span className={highlight ? "text-vigil-accent font-bold font-mono" : "text-white font-mono"}>
        {value}
      </span>
    </div>
  );
}
