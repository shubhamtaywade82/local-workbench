// Unified diff and patch preview renderer. Color-codes additions, removals,
// and hunk headers with line-level formatting.

"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground font-bold";
  if (line.startsWith("+")) return "bg-emerald-500/15 text-emerald-900 dark:text-emerald-200";
  if (line.startsWith("-")) return "bg-rose-500/15 text-rose-900 dark:text-rose-200";
  if (line.startsWith("@@")) return "bg-sky-500/15 text-sky-900 dark:text-sky-300 font-semibold";
  return "text-foreground opacity-80";
}

export function DiffPreviewRenderer({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);
  const lines = source.split("\n");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="rounded bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-sky-600">
            DIFF / PATCH
          </span>
          <span className="text-muted-foreground text-[11px]">{lines.length} lines</span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2 font-mono text-xs">
        {lines.map((line, idx) => (
          <div key={idx} className={`flex px-2 py-0.5 ${diffLineClass(line)}`}>
            <span className="w-10 select-none text-right pr-3 opacity-40">{idx + 1}</span>
            <span className="whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
