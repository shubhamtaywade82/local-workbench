// Text fallback renderer for formats we don't have a richer preview for, or
// when a parser failed. Shows the raw source as a <pre> block with monospace.

"use client";

interface Props {
  source: string;
  language: string;
}

export function TextFallbackRenderer({ source, language }: Props) {
  return (
    <div className="h-full overflow-auto p-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5">{language}</span>
        <span>raw source</span>
      </div>
      <pre className="overflow-auto rounded border bg-muted/40 p-3 text-xs leading-relaxed">
        <code>{source}</code>
      </pre>
    </div>
  );
}
