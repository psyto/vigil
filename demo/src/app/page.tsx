"use client";

import { useEffect, useState } from "react";
import { NcnSelector } from "@/components/ncn-selector";
import { YieldMarketPanel } from "@/components/yield-market-panel";
import { UptimeMarketPanel } from "@/components/uptime-market-panel";
import { ScenarioPanel } from "@/components/scenario-panel";
import { useVigilStore } from "@/lib/store";
import { runTestVectors } from "@/lib/pricing";
import { Shield } from "lucide-react";

export default function DemoPage() {
  const preset = useVigilStore((s) => s.preset);
  const [testResults, setTestResults] = useState<
    { name: string; pass: boolean }[] | null
  >(null);

  // Run test vectors on mount to verify pricing engine
  useEffect(() => {
    const results = runTestVectors();
    const allPass = results.every((r) => r.pass);
    if (!allPass) {
      console.error("Pricing test vectors FAILED:", results);
    } else {
      console.log("All pricing test vectors passed");
    }
    setTestResults(results);
  }, []);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="w-7 h-7 text-vigil-accent" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Vigil</h1>
          <p className="text-xs text-vigil-muted">Restaking Risk Simulator</p>
        </div>
        <div className="ml-auto text-xs text-vigil-muted">
          {preset.name} &mdash; {preset.description}
        </div>
      </div>

      {/* NCN Tabs */}
      <NcnSelector />

      {/* Markets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <YieldMarketPanel />
        <UptimeMarketPanel />
      </div>

      {/* Simulation */}
      <ScenarioPanel />

      {/* Test vector status */}
      {testResults && (
        <div className="text-xs text-vigil-muted flex items-center gap-2">
          <span>Pricing engine:</span>
          {testResults.every((r) => r.pass) ? (
            <span className="text-vigil-green font-medium">
              {testResults.length}/{testResults.length} test vectors passed
            </span>
          ) : (
            <span className="text-vigil-red font-medium">
              {testResults.filter((r) => r.pass).length}/{testResults.length}{" "}
              test vectors passed
            </span>
          )}
        </div>
      )}
    </main>
  );
}
