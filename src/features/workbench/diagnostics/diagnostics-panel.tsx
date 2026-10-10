// Diagnostics / "Problems" panel. Aggregates diagnostics across all open
// documents and shows them in a flat list. Clicking a diagnostic moves the
// Monaco editor cursor to the right line/column.

"use client";

import { useWorkbench } from "@/features/workbench/store";
import { AlertCircle, AlertTriangle, Info, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import type { Diagnostic } from "@/documents/core/types";

export function DiagnosticsPanel() {
  // Read the diagnostics map (stable per-change) and flatten in a memoised
  // derived value. Avoids infinite re-render loops from returning a fresh
  // array reference on every state change.
  const diagMap = useWorkbench((s) => s.diagnostics);
  const diagnostics = useMemo<Diagnostic[]>(
    () => Object.values(diagMap).flat(),
    [diagMap]
  );
  const setActiveTab = useWorkbench((s) => s.setActiveTab);
  const sessions = useWorkbench((s) => s.sessions);
  const setDiagnosticsVisible = useWorkbench((s) => s.setDiagnosticsVisible);

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const infos = diagnostics.filter((d) => d.severity === "info" || d.severity === "hint");

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-9 items-center justify-between border-b bg-muted/30 px-3">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold">Problems</span>
          <span className="flex items-center gap-1 text-destructive">
            <AlertCircle className="h-3 w-3" />
            {errors.length}
          </span>
          <span className="flex items-center gap-1 text-amber-500">
            <AlertTriangle className="h-3 w-3" />
            {warnings.length}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Info className="h-3 w-3" />
            {infos.length}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setDiagnosticsVisible(false)}
          title="Hide panel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="py-1 text-xs">
          {diagnostics.length === 0 && (
            <div className="px-3 py-4 text-muted-foreground">
              No problems detected in open files.
            </div>
          )}
          {diagnostics.map((d, i) => (
            <DiagnosticRow key={i} diag={d} onClick={() => {
              // Switch to the file (if open) — Monaco jumps to the marker
              // when the user clicks it (handled by the marker's range).
              if (sessions[d.filePath]) {
                setActiveTab(d.filePath);
              }
            }} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function DiagnosticRow({
  diag,
  onClick,
}: {
  diag: Diagnostic;
  onClick: () => void;
}) {
  const Icon =
    diag.severity === "error"
      ? AlertCircle
      : diag.severity === "warning"
        ? AlertTriangle
        : Info;
  const color =
    diag.severity === "error"
      ? "text-destructive"
      : diag.severity === "warning"
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-muted/40"
    >
      <Icon className={cn("mt-0.5 h-3 w-3 shrink-0", color)} />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <span className="font-mono text-[10px] text-muted-foreground">{diag.filePath}</span>
          {diag.range && (
            <span className="ml-1 text-[10px] text-muted-foreground">
              :{diag.range.startLine}:{diag.range.startColumn}
            </span>
          )}
        </div>
        <div className="truncate">
          {diag.message}
          {diag.source && (
            <span className="ml-2 text-[10px] text-muted-foreground">
              [{diag.source}{diag.code ? ` ${diag.code}` : ""}]
            </span>
          )}
        </div>
      </div>
      {diag.fixes && diag.fixes.length > 0 && (
        <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
