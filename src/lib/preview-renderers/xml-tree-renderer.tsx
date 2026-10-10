// XML tree renderer. Uses the parsed JS object from the XML adapter and
// renders a tree similar to the structured-data renderer but with XML-aware
// labels (elements vs attributes).

"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Code2, AtSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  source: string;
  value: unknown;
}

export function XmlTreeRenderer({ source, value }: Props) {
  return (
    <div className="h-full overflow-auto p-3 text-xs">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5">xml</span>
        <span>element tree</span>
      </div>
      {value == null ? (
        <pre className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive">
          {source}
        </pre>
      ) : (
        <XmlNode label="document" value={value} depth={0} root />
      )}
    </div>
  );
}

function XmlNode({
  label,
  value,
  depth,
  root,
}: {
  label?: string;
  value: unknown;
  depth: number;
  root?: boolean;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (typeof value !== "object" || value == null) {
    return (
      <div className={cn("flex items-center gap-1 py-0.5", !root && "ml-3 border-l border-border/60 pl-2")}>
        <Code2 className="h-3 w-3 text-muted-foreground" />
        {label && <span className="font-mono text-foreground">{label}:</span>}
        <span className="font-mono text-emerald-600 dark:text-emerald-400">
          {String(value)}
        </span>
      </div>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);

  // Separate attributes (start with "@_") from child elements.
  const attrs = entries.filter(([k]) => k.startsWith("@_"));
  const children = entries.filter(([k]) => !k.startsWith("@_"));

  return (
    <div className={cn(!root && "ml-3 border-l border-border/60 pl-2")}>
      <button
        className="flex w-full items-center gap-1 py-0.5 text-left hover:bg-muted/40"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Code2 className="h-3 w-3 text-muted-foreground" />
        {label && <span className="font-mono text-foreground">{label}</span>}
        {attrs.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            ({attrs.length} attr)
          </span>
        )}
      </button>
      {open && (
        <div>
          {attrs.map(([k, v]) => (
            <div key={k} className="ml-3 flex items-center gap-1 border-l border-border/60 pl-2 py-0.5">
              <AtSign className="h-3 w-3 text-fuchsia-500" />
              <span className="font-mono text-fuchsia-600 dark:text-fuchsia-400">
                {k.slice(2)}
              </span>
              <span className="text-muted-foreground">=</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                &quot;{String(v)}&quot;
              </span>
            </div>
          ))}
          {children.map(([k, v]) => (
            <XmlNode key={k} label={k} value={v} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
