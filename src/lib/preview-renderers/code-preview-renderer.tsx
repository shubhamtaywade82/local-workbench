// Source code preview renderer with Prism syntax highlighting, line numbers,
// and copy-to-clipboard functionality.

"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

import { useWorkbench } from "@/features/workbench/store";

interface Props {
  source: string;
  language: string;
}

export function CodePreviewRenderer({ source, language }: Props) {
  const [copied, setCopied] = useState(false);
  const theme = useWorkbench((s) => s.theme);
  const lineCount = source.split("\n").length;

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
          <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-primary">
            {language}
          </span>
          <span className="text-muted-foreground text-[11px]">
            {lineCount.toLocaleString()} lines · {source.length.toLocaleString()} chars
          </span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted transition-colors"
          title="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2">
        <SyntaxHighlighter
          language={language}
          style={theme === "dark" ? oneDark : oneLight}
          showLineNumbers
          customStyle={{
            margin: 0,
            padding: "1rem",
            fontSize: "0.8125rem",
            background: "transparent",
            fontFamily: "var(--font-mono), monospace",
          }}
        >
          {source}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
