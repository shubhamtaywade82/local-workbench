// Empty state shown in the editor area when no tab is active.

"use client";

import { FileText } from "lucide-react";

export function EditorEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <FileText className="h-8 w-8 opacity-40" />
      <div className="text-sm font-medium">No file open</div>
      <div className="text-xs">Pick a file from the explorer to start editing.</div>
    </div>
  );
}
