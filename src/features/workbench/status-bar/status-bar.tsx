// Status bar / sticky footer. Shows workspace, active file, dirty count,
// diagnostics summary, AI provider status, theme toggle, and panel toggles.

"use client";

import { useWorkbench } from "@/features/workbench/store";
import {
  PanelLeft,
  Eye,
  Bot,
  Stethoscope,
  AlertCircle,
  AlertTriangle,
  Info,
  Circle,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

export function StatusBar() {
  const workspace = useWorkbench((s) => s.workspace);
  const activeTab = useWorkbench((s) => s.activeTab);
  const sessions = useWorkbench((s) => s.sessions);
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
  const aiProvider = useWorkbench((s) => s.aiProvider);

  // Stable map refs + memoised derived values to avoid infinite re-render
  // loops from returning fresh arrays/objects on every state change.
  const diagMap = useWorkbench((s) => s.diagnostics);
  const diagnostics = useMemo(
    () => Object.values(diagMap).flat(),
    [diagMap]
  );
  const dirtyCount = useMemo(
    () => Object.values(sessions).filter((s) => s.isDirty).length,
    [sessions]
  );

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const infos = diagnostics.filter((d) => d.severity === "info" || d.severity === "hint").length;

  return (
    <footer className="flex h-7 shrink-0 items-stretch border-t bg-primary text-primary-foreground text-[11px]">
      <div className="flex items-center gap-3 px-3 py-1">
        <button
          className={cn("flex items-center gap-1 rounded px-1 hover:bg-primary-foreground/10", !explorerVisible && "opacity-60")}
          onClick={() => setExplorerVisible(!explorerVisible)}
          title="Toggle explorer (⌘B)"
        >
          <PanelLeft className="h-3 w-3" />
        </button>
        <button
          className={cn("flex items-center gap-1 rounded px-1 hover:bg-primary-foreground/10", !previewVisible && "opacity-60")}
          onClick={() => setPreviewVisible(!previewVisible)}
          title="Toggle preview"
        >
          <Eye className="h-3 w-3" />
        </button>
        <button
          className={cn("flex items-center gap-1 rounded px-1 hover:bg-primary-foreground/10", !diagnosticsVisible && "opacity-60")}
          onClick={() => setDiagnosticsVisible(!diagnosticsVisible)}
          title="Toggle diagnostics (⌘J)"
        >
          <Stethoscope className="h-3 w-3" />
        </button>
        <button
          className={cn("flex items-center gap-1 rounded px-1 hover:bg-primary-foreground/10", !aiVisible && "opacity-60")}
          onClick={() => setAiVisible(!aiVisible)}
          title="Toggle AI (⌘⇧A)"
        >
          <Bot className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-3 border-l px-3 py-1">
        <span className="truncate">
          {workspace ? workspace.name : "no workspace"}
        </span>
        {workspace && (
          <span className="opacity-60">{workspace.source}</span>
        )}
      </div>

      {activeTab && (
        <div className="hidden items-center gap-2 border-l px-3 py-1 sm:flex">
          <span className="truncate">{activeTab}</span>
          {sessions[activeTab]?.isDirty && (
            <span className="flex items-center gap-1 text-amber-300">
              <Circle className="h-2 w-2 fill-amber-300" />
              unsaved
            </span>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-3 border-l px-3 py-1">
        <span className="flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {errors}
        </span>
        <span className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {warnings}
        </span>
        <span className="flex items-center gap-1 opacity-70">
          <Info className="h-3 w-3" />
          {infos}
        </span>
        <span className="hidden items-center gap-1 border-l pl-3 opacity-70 md:flex">
          {dirtyCount} dirty
        </span>
        <span className="hidden items-center gap-1 border-l pl-3 opacity-70 md:flex">
          AI: {aiProvider?.available ? "ready" : "offline"}
        </span>
      </div>

      <button
        className="flex items-center gap-1 border-l px-3 py-1 hover:bg-primary-foreground/10"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title="Toggle theme"
      >
        {theme === "dark" ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
        <span className="hidden sm:inline">{theme === "dark" ? "light" : "dark"}</span>
      </button>
    </footer>
  );
}
