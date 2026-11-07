// The assistant's connection state. Offline shows the reason, so the next step is
// clear: set a key, or start the local model server.

"use client";

import { useAssistantState } from "@/features/workbench/ai/wiring";
import { cn } from "@/lib/utils";

export function ProviderStatus() {
  const provider = useAssistantState((s) => s.provider);
  if (!provider) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse" />
        Checking…
      </span>
    );
  }
  return (
    <span
      role="status"
      title={provider.available ? `${provider.name} · ${provider.model}` : provider.reason ?? "Offline"}
      className="inline-flex max-w-[11rem] items-center gap-1.5 text-[11px] text-muted-foreground"
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", provider.available ? "bg-emerald-500" : "bg-amber-500")}
      />
      <span className="truncate">{provider.available ? provider.model || provider.name : "Offline"}</span>
    </span>
  );
}
