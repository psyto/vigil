"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { NCN_PRESETS } from "@/lib/ncn-presets";
import { useVigilStore } from "@/lib/store";
import { Shield, Globe, Zap } from "lucide-react";

const ICONS: Record<string, React.ReactNode> = {
  pyth: <Shield className="w-4 h-4" />,
  wormhole: <Globe className="w-4 h-4" />,
  jito: <Zap className="w-4 h-4" />,
};

export function NcnSelector() {
  const ncnId = useVigilStore((s) => s.ncnId);
  const selectNcn = useVigilStore((s) => s.selectNcn);

  return (
    <Tabs.Root value={ncnId} onValueChange={selectNcn}>
      <Tabs.List className="flex gap-2">
        {NCN_PRESETS.map((p) => (
          <Tabs.Trigger
            key={p.id}
            value={p.id}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              data-[state=inactive]:bg-vigil-surface data-[state=inactive]:text-vigil-muted data-[state=inactive]:hover:text-slate-300
              data-[state=active]:bg-vigil-accent data-[state=active]:text-white"
          >
            {ICONS[p.id]}
            {p.name}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
