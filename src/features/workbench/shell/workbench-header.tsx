// The application header: navigation on the left, the file's path in the
// middle, and the document's state and the main actions on the right. On a
// phone the labels fall away and the icons remain.

"use client";

import { AlertTriangle, Command, PanelLeft, PanelRight, Save, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAssistantState } from "@/features/workbench/ai/wiring";
import { useWorkbench } from "@/features/workbench/store";
import type { Breakpoint } from "@/lib/hooks/use-breakpoint";
import { cn } from "@/lib/utils";

interface WorkbenchHeaderProps {
  readonly breakpoint: Breakpoint;
  readonly onSave: () => void;
}

export function WorkbenchHeader({ breakpoint, onSave }: WorkbenchHeaderProps) {
  const activeTab = useWorkbench((s) => s.activeTab);
  const activeDirty = useWorkbench((s) => (s.activeTab ? s.sessions[s.activeTab]?.isDirty === true : false));
  const dirtyCount = useWorkbench((s) => Object.values(s.sessions).filter((x) => x.isDirty).length);
  const problemCount = useWorkbench((s) => Object.values(s.diagnostics).reduce((n, list) => n + list.filter((d) => d.severity === "error" || d.severity === "warning").length, 0));
  const explorerVisible = useWorkbench((s) => s.explorerVisible);
  const previewVisible = useWorkbench((s) => s.previewVisible);
  const diagnosticsVisible = useWorkbench((s) => s.diagnosticsVisible);
  const aiVisible = useWorkbench((s) => s.aiVisible);
  const workspaceName = useWorkbench((s) => s.workspace?.name ?? null);
  const setExplorerVisible = useWorkbench((s) => s.setExplorerVisible);
  const setPreviewVisible = useWorkbench((s) => s.setPreviewVisible);
  const setDiagnosticsVisible = useWorkbench((s) => s.setDiagnosticsVisible);
  const setAiVisible = useWorkbench((s) => s.setAiVisible);
  const setCommandPaletteOpen = useWorkbench((s) => s.setCommandPaletteOpen);
  const assistantBusy = useAssistantState((s) => s.activeRun !== null);

  const segments = activeTab ? activeTab.split("/") : [];
  const fileName = segments.at(-1) ?? null;
  const phone = breakpoint === "phone";

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b bg-card px-2 text-xs">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={explorerVisible ? "Hide files" : "Show files"}
        aria-pressed={explorerVisible}
        title={explorerVisible ? "Hide files (Ctrl+B)" : "Show files (Ctrl+B)"}
        onClick={() => setExplorerVisible(!explorerVisible)}
      >
        <PanelLeft className="h-4 w-4" aria-hidden="true" />
      </Button>

      {!phone && (
        <div className="flex min-w-0 shrink items-center gap-2 pr-2">
          <span className="font-semibold tracking-tight">Local Workbench</span>
          {workspaceName && <span className="max-w-[10rem] truncate text-muted-foreground" title={workspaceName}>{workspaceName}</span>}
        </div>
      )}

      <nav aria-label="Open file" className="flex min-w-0 flex-1 items-center justify-center">
        {fileName && (
          <p className="flex min-w-0 items-center gap-1 text-[12px]" title={activeTab ?? undefined}>
            {!phone && segments.length > 1 && <span className="truncate text-muted-foreground">{segments.slice(0, -1).join(" / ")} /</span>}
            <span className={cn("truncate font-medium", activeDirty && "text-amber-700 dark:text-amber-300")}>{fileName}</span>
            {activeDirty && <span aria-label="unsaved changes" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
          </p>
        )}
      </nav>

      <span className={cn("hidden shrink-0 text-[11px] sm:inline", dirtyCount > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")} aria-live="polite">
        {dirtyCount > 0 ? `${dirtyCount} unsaved` : "Saved"}
      </span>

      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Save file" title="Save (Ctrl+S)" disabled={!activeTab} onClick={onSave}>
        <Save className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>

      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Open command palette" title="Command palette (Ctrl+P)" onClick={() => setCommandPaletteOpen(true)}>
        <Command className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 gap-1 px-1.5"
        aria-label={`Problems: ${problemCount}`}
        aria-pressed={diagnosticsVisible}
        title="Problems (Ctrl+J)"
        onClick={() => setDiagnosticsVisible(!diagnosticsVisible)}
      >
        <AlertTriangle className={cn("h-3.5 w-3.5", problemCount > 0 && "text-amber-600 dark:text-amber-400")} aria-hidden="true" />
        <span className="tabular-nums">{problemCount}</span>
      </Button>

      {!phone && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={previewVisible ? "Hide preview" : "Show preview"}
          aria-pressed={previewVisible}
          title="Toggle preview"
          onClick={() => setPreviewVisible(!previewVisible)}
        >
          <PanelRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}

      <Button
        variant={aiVisible ? "secondary" : "ghost"}
        size="sm"
        className="relative h-7 shrink-0 gap-1 px-2"
        aria-label={aiVisible ? "Hide assistant" : "Show assistant"}
        aria-pressed={aiVisible}
        title="Assistant (Ctrl+Shift+A)"
        onClick={() => setAiVisible(!aiVisible)}
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        {!phone && <span>Assistant</span>}
        {assistantBusy && <span aria-label="The assistant is working" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" />}
      </Button>
    </header>
  );
}
