// Empty state shown in the editor area when no tab is active.

"use client";

import { FileText, FileX } from "lucide-react";

export function EditorEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <FileText className="h-8 w-8 opacity-40" />
      <div className="text-sm font-medium">No file open</div>
      <div className="text-xs">Pick a file from the explorer to start editing.</div>
    </div>
  );
}

export function UnsupportedEditorState({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const fileName = path.split("/").pop() ?? path;
  const ext = fileName.split(".").pop()?.toUpperCase() ?? "FILE";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
        <FileX className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">Unsupported File</div>
        <div className="mt-1 text-xs text-muted-foreground">
          &ldquo;{fileName}&rdquo; ({ext}) cannot be opened or edited in the workbench editor.
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
      >
        Close tab
      </button>
    </div>
  );
}

