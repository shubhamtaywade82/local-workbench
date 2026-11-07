// The status bar: the open file, document and problem counts, the assistant's
// connection, and the panel toggles. Labels give way to icons on a phone.

"use client";

import { Bot, Circle, CircleX, Eye, PanelLeft, Stethoscope, Sun, Moon, TriangleAlert, type LucideIcon } from "lucide-react";

import { useAssistantState } from "@/features/workbench/ai/wiring";
import { useWorkbench } from "@/features/workbench/store";
import { WorkspaceSwitcher } from "@/features/workbench/shell/workspace-switcher";
import type { Breakpoint } from "@/lib/hooks/use-breakpoint";
import { cn } from "@/lib/utils";

const TOGGLE = "flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60";

/** A problem count. On a phone it is an icon and a number; the word stays available to assistive tech. */
function Count({ icon: Icon, n, label, phone }: { readonly icon: LucideIcon; readonly n: number; readonly label: string; readonly phone: boolean }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap" title={`${n} ${label}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {phone ? (
        <>
          <span>{n}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        <span>
          {n} {label}
        </span>
      )}
    </span>
  );
}

export function StatusBar({ breakpoint }: { readonly breakpoint: Breakpoint }) {
  const activeTab = useWorkbench((s) => s.activeTab);
  const activeDirty = useWorkbench((s) => (s.activeTab ? s.sessions[s.activeTab]?.isDirty === true : false));
  const dirtyCount = useWorkbench((s) => Object.values(s.sessions).filter((x) => x.isDirty).length);
  const errors = useWorkbench((s) => Object.values(s.diagnostics).reduce((n, list) => n + list.filter((d) => d.severity === "error").length, 0));
  const warnings = useWorkbench((s) => Object.values(s.diagnostics).reduce((n, list) => n + list.filter((d) => d.severity === "warning").length, 0));
  const explorerVisible = useWorkbench((s) => s.explorerVisible);
  const previewVisible = useWorkbench((s) => s.previewVisible);
  const aiVisible = useWorkbench((s) => s.aiVisible);
  const diagnosticsVisible = useWorkbench((s) => s.diagnosticsVisible);
  const setExplorerVisible = useWorkbench((s) => s.setExplorerVisible);
  const setPreviewVisible = useWorkbench((s) => s.setPreviewVisible);
  const setAiVisible = useWorkbench((s) => s.setAiVisible);
  const setDiagnosticsVisible = useWorkbench((s) => s.setDiagnosticsVisible);
  const theme = useWorkbench((s) => s.theme);
  const setTheme = useWorkbench((s) => s.setTheme);
  const provider = useAssistantState((s) => s.provider);
  const phone = breakpoint === "phone";

  return (
    <footer className="flex h-7 shrink-0 items-stretch border-t bg-primary text-[11px] text-primary-foreground">
      <div className="flex items-center gap-1 px-2">
        {!phone && (
          <button className={cn(TOGGLE, !explorerVisible && "opacity-60")} onClick={() => setExplorerVisible(!explorerVisible)} aria-pressed={explorerVisible} aria-label="Files panel" title="Toggle files (Ctrl+B)">
            <PanelLeft className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
        {!phone && (
          <button className={cn(TOGGLE, !previewVisible && "opacity-60")} onClick={() => setPreviewVisible(!previewVisible)} aria-pressed={previewVisible} aria-label="Preview panel" title="Toggle preview">
            <Eye className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
        <button className={cn(TOGGLE, !diagnosticsVisible && "opacity-60")} onClick={() => setDiagnosticsVisible(!diagnosticsVisible)} aria-pressed={diagnosticsVisible} aria-label="Problems panel" title="Toggle problems (Ctrl+J)">
          <Stethoscope className="h-3 w-3" aria-hidden="true" />
        </button>
        <button className={cn(TOGGLE, !aiVisible && "opacity-60")} onClick={() => setAiVisible(!aiVisible)} aria-pressed={aiVisible} aria-label="Assistant panel" title="Toggle assistant (Ctrl+Shift+A)">
          <Bot className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center border-l px-1.5">
        <WorkspaceSwitcher variant="compact" className="hover:bg-primary-foreground/10" />
      </div>

      {activeTab && !phone && (
        <div className="hidden min-w-0 items-center gap-2 border-l px-3 py-1 sm:flex">
          <span className="truncate" title={activeTab}>{activeTab}</span>
          {activeDirty && (
            <span className="flex shrink-0 items-center gap-1 text-amber-200">
              <Circle className="h-2 w-2 fill-amber-200" aria-hidden="true" />
              unsaved
            </span>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-3 whitespace-nowrap border-l px-3 py-1" role="group" aria-label="Problems">
        <Count icon={CircleX} n={errors} label="errors" phone={phone} />
        <Count icon={TriangleAlert} n={warnings} label="warnings" phone={phone} />
        {!phone && <span className="opacity-80">{dirtyCount} unsaved</span>}
        {!phone && (
          <span className="border-l pl-3 opacity-90" role="status" title={provider?.available ? `${provider.name} · ${provider.model}` : provider?.reason ?? undefined}>
            {provider === null ? "AI · checking" : provider.available ? `AI · ${provider.model || provider.name}` : "AI · offline"}
          </span>
        )}
      </div>

      <button className="flex items-center gap-1 border-l px-3 py-1 hover:bg-primary-foreground/10" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Toggle theme">
        {theme === "dark" ? <Sun className="h-3 w-3" aria-hidden="true" /> : <Moon className="h-3 w-3" aria-hidden="true" />}
        {!phone && <span>{theme === "dark" ? "light" : "dark"}</span>}
      </button>
    </footer>
  );
}
