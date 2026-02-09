"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, RotateCcw, AlertTriangle, Info, AlertOctagon } from "lucide-react";
import { useVigilStore } from "@/lib/store";
import { simulationTick } from "@/lib/simulation";

const SEVERITY_STYLES = {
  info: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    text: "text-blue-400",
    icon: Info,
  },
  warning: {
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    text: "text-yellow-400",
    icon: AlertTriangle,
  },
  critical: {
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    text: "text-red-400",
    icon: AlertOctagon,
  },
};

export function ScenarioPanel() {
  const running = useVigilStore((s) => s.running);
  const events = useVigilStore((s) => s.events);
  const toggleRunning = useVigilStore((s) => s.toggleRunning);
  const reset = useVigilStore((s) => s.reset);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        const state = useVigilStore.getState();
        if (state.running) {
          simulationTick(state);
        }
      }, 1500);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  return (
    <div className="bg-vigil-surface border border-vigil-border rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-vigil-accent uppercase tracking-wider">
          Live Scenario
        </h2>
        <div className="flex gap-2">
          <button
            onClick={toggleRunning}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              running
                ? "bg-vigil-yellow/10 border border-vigil-yellow/30 text-vigil-yellow hover:bg-vigil-yellow/20"
                : "bg-vigil-green/10 border border-vigil-green/30 text-vigil-green hover:bg-vigil-green/20"
            }`}
          >
            {running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {running ? "Pause" : "Play"}
          </button>
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
              bg-vigil-bg border border-vigil-border text-vigil-muted hover:text-white transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </div>
      </div>

      {/* Event timeline */}
      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
        {events.length === 0 && (
          <div className="text-xs text-vigil-muted text-center py-4">
            Press Play to start the simulation, or adjust parameters manually.
          </div>
        )}
        <AnimatePresence initial={false}>
          {events.map((evt) => {
            const style = SEVERITY_STYLES[evt.severity];
            const Icon = style.icon;
            return (
              <motion.div
                key={evt.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${style.bg} border ${style.border}`}
              >
                <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${style.text}`} />
                <span className="text-vigil-muted font-mono shrink-0">
                  {formatTick(evt.tick)}
                </span>
                <span className={style.text}>{evt.message}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function formatTick(tick: number): string {
  const totalSec = tick * 1.5;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
