"use client";

import { useMemo } from "react";
import * as Slider from "@radix-ui/react-slider";
import * as Select from "@radix-ui/react-select";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { ChevronDown, Skull } from "lucide-react";
import { useVigilStore } from "@/lib/store";
import {
  computeUptimePrice,
  uptimeSpreadSmile,
  SIGNAL_LABELS,
  SIGNAL_SPREAD_BPS,
  type SignalSeverity,
} from "@/lib/pricing";

const SIGNALS: SignalSeverity[] = [0, 1, 2, 3];

export function UptimeMarketPanel() {
  const uptimeE6 = useVigilStore((s) => s.uptimeE6);
  const signal = useVigilStore((s) => s.signal);
  const preset = useVigilStore((s) => s.preset);
  const setUptimePercent = useVigilStore((s) => s.setUptimePercent);
  const setSignal = useVigilStore((s) => s.setSignal);
  const injectSlashing = useVigilStore((s) => s.injectSlashing);

  const uptimePct = Number(uptimeE6) / 10_000;

  const pricing = useMemo(
    () =>
      computeUptimePrice({
        baseSpreadBps: preset.baseSpreadBps,
        edgeSpreadBps: preset.edgeSpreadBps,
        maxSpreadBps: preset.maxUptimeSpreadBps,
        uptimeE6,
        signalAdjustedSpread: SIGNAL_SPREAD_BPS[signal],
      }),
    [uptimeE6, signal, preset],
  );

  const smileData = useMemo(
    () =>
      uptimeSpreadSmile(
        preset.baseSpreadBps,
        preset.edgeSpreadBps,
        preset.maxUptimeSpreadBps,
        SIGNAL_SPREAD_BPS[signal],
      ),
    [signal, preset],
  );

  const execPricePct = (Number(pricing.execPrice) / 10_000).toFixed(2);
  const edgeFactorDisplay = (Number(pricing.edgeFactor) / 1_000_000).toFixed(1);

  return (
    <div className="bg-vigil-surface border border-vigil-border rounded-xl p-5 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-vigil-accent uppercase tracking-wider">
        Uptime Market
      </h2>

      {/* Uptime Slider */}
      <div>
        <div className="flex justify-between text-xs text-vigil-muted mb-2">
          <span>Uptime</span>
          <span className="text-white font-mono">{uptimePct.toFixed(1)}%</span>
        </div>
        <Slider.Root
          className="relative flex items-center w-full h-5 select-none touch-none"
          value={[uptimePct * 100]}
          onValueChange={([v]) => setUptimePercent(v / 100)}
          min={10}
          max={9999}
          step={1}
        >
          <Slider.Track className="relative grow h-1 rounded-full bg-vigil-border">
            <Slider.Range className="absolute h-full rounded-full bg-vigil-green" />
          </Slider.Track>
          <Slider.Thumb className="block w-4 h-4 rounded-full bg-vigil-green border-2 border-vigil-bg focus:outline-none focus:ring-2 focus:ring-vigil-green/30" />
        </Slider.Root>
      </div>

      {/* Signal Selector */}
      <div>
        <div className="text-xs text-vigil-muted mb-1">Signal</div>
        <Select.Root
          value={String(signal)}
          onValueChange={(v) => setSignal(Number(v) as SignalSeverity)}
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
                {SIGNALS.map((s) => (
                  <Select.Item
                    key={s}
                    value={String(s)}
                    className="px-3 py-1.5 text-sm rounded cursor-pointer outline-none data-[highlighted]:bg-vigil-accent/20 data-[highlighted]:text-white"
                  >
                    <Select.ItemText>{SIGNAL_LABELS[s]}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      {/* Pricing breakdown */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <PricingRow label="Edge Factor" value={`${edgeFactorDisplay}x`} />
        <PricingRow label="Signal Spread" value={String(SIGNAL_SPREAD_BPS[signal])} />
        <PricingRow label="Total Spread" value={`${pricing.totalSpread} bps`} />
        <PricingRow
          label="Exec Price"
          value={`${execPricePct}%`}
          highlight
        />
      </div>

      {/* Spread smile chart */}
      <div className="h-40 mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={smileData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
            <XAxis
              dataKey="uptime"
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={{ stroke: "#1e1e2e" }}
              label={{ value: "Uptime %", position: "insideBottom", offset: -2, fill: "#64748b", fontSize: 10 }}
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
            <defs>
              <linearGradient id="smileGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="spread"
              stroke="#6366f1"
              fill="url(#smileGrad)"
              strokeWidth={2}
            />
            <ReferenceLine
              x={Math.round(uptimePct)}
              stroke="#ef4444"
              strokeDasharray="3 3"
              label={{ value: "current", fill: "#ef4444", fontSize: 10, position: "top" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Inject Slashing */}
      <button
        onClick={injectSlashing}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-vigil-red/10 border border-vigil-red/30 text-vigil-red rounded-lg text-sm font-medium
          hover:bg-vigil-red/20 transition-colors"
      >
        <Skull className="w-4 h-4" />
        Inject Slashing Event
      </button>
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
      <span className={highlight ? "text-vigil-green font-bold font-mono" : "text-white font-mono"}>
        {value}
      </span>
    </div>
  );
}
