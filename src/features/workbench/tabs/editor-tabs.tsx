// Editor tab bar. Shows all open tabs with dirty indicators and close buttons.

"use client";

import { X, Circle } from "lucide-react";
import { useWorkbench } from "@/features/workbench/store";
import { cn } from "@/lib/utils";
import { fileIconColor } from "@/features/workbench/file-explorer/file-explorer";

export function EditorTabs() {
  const openTabs = useWorkbench((s) => s.openTabs);
  const activeTab = useWorkbench((s) => s.activeTab);
  const sessions = useWorkbench((s) => s.sessions);
  const setActiveTab = useWorkbench((s) => s.setActiveTab);
  const closeTab = useWorkbench((s) => s.closeTab);

  if (openTabs.length === 0) {
    return (
      <div className="flex h-9 items-center border-b px-3 text-xs text-muted-foreground">
        No file open
      </div>
    );
  }

  return (
    <div className="flex h-9 items-stretch overflow-x-auto border-b bg-muted/30">
      {openTabs.map((tab) => {
        const session = sessions[tab.path];
        const isDirty = session?.isDirty ?? false;
        const isActive = tab.path === activeTab;
        return (
          <div
            key={tab.path}
            className={cn(
              "group flex min-w-[140px] max-w-[220px] cursor-pointer items-center gap-2 border-r px-3 text-xs",
              isActive ? "bg-background text-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
            )}
            onClick={() => setActiveTab(tab.path)}
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", fileIconColor(tab.path) ?? "bg-foreground")} style={{ backgroundColor: "currentColor" }} />
            <span className={cn("truncate", isActive && "font-medium")}>
              {tab.name}
            </span>
            <button
              className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-foreground/10"
              onClick={(e) => {
                e.stopPropagation();
                if (isDirty && !confirm(`${tab.name} has unsaved changes. Close anyway?`)) {
                  return;
                }
                closeTab(tab.path);
              }}
              aria-label={`Close ${tab.name}`}
            >
              {isDirty ? (
                <Circle className="h-2 w-2 fill-amber-500 text-amber-500" />
              ) : (
                <X className="h-3 w-3" />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
