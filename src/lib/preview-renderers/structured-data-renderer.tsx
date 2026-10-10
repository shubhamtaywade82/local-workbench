// Structured data renderer. Recursively walks the parsed value and renders a
// clean, syntax-highlighted tree/table view for JSON-family / YAML / TOML /
// TOON previews.

"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Hash, List, Braces, Quote, Dot } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: unknown;
  format: string;
}

export function StructuredDataRenderer({ value, format }: Props) {
  return (
    <div className="h-full overflow-auto p-3 text-xs">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5">{format}</span>
        <span>parsed structure</span>
      </div>
      <Node label="root" value={value} depth={0} root />
    </div>
  );
}

function Node({
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

  if (value === null) {
    return <ScalarRow label={label} value="null" kind="null" root={root} />;
  }
  if (typeof value === "boolean") {
    return <ScalarRow label={label} value={value ? "true" : "false"} kind="bool" root={root} />;
  }
  if (typeof value === "number") {
    return <ScalarRow label={label} value={String(value)} kind="number" root={root} />;
  }
  if (typeof value === "string") {
    return <ScalarRow label={label} value={value} kind="string" root={root} />;
  }
  if (Array.isArray(value)) {
    return (
      <CollapsibleRow
        label={label}
        icon={<List className="h-3 w-3 text-muted-foreground" />}
        count={value.length}
        open={open}
        onToggle={() => setOpen(!open)}
        root={root}
      >
        {value.map((item, i) => (
          <Node key={i} label={String(i)} value={item} depth={depth + 1} />
        ))}
      </CollapsibleRow>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <CollapsibleRow
        label={label}
        icon={<Braces className="h-3 w-3 text-muted-foreground" />}
        count={entries.length}
        open={open}
        onToggle={() => setOpen(!open)}
        root={root}
      >
        {entries.map(([k, v]) => (
          <Node key={k} label={k} value={v} depth={depth + 1} />
        ))}
      </CollapsibleRow>
    );
  }
  return <ScalarRow label={label} value={String(value)} kind="string" root={root} />;
}

function CollapsibleRow({
  label,
  icon,
  count,
  open,
  onToggle,
  root,
  children,
}: {
  label?: string;
  icon: React.ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  root?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(!root && "ml-3 border-l border-border/60 pl-2")}>
      <button
        className="flex w-full items-center gap-1 py-0.5 text-left hover:bg-muted/40"
        onClick={onToggle}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {icon}
        {label && (
          <span className="font-mono text-foreground">{label}:</span>
        )}
        <span className="text-muted-foreground">{count} {count === 1 ? "item" : "items"}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function ScalarRow({
  label,
  value,
  kind,
  root,
}: {
  label?: string;
  value: string;
  kind: "string" | "number" | "bool" | "null";
  root?: boolean;
}) {
  const Icon =
    kind === "string" ? Quote : kind === "number" ? Hash : kind === "bool" ? Dot : Dot;
  const color =
    kind === "string"
      ? "text-emerald-600 dark:text-emerald-400"
      : kind === "number"
        ? "text-amber-600 dark:text-amber-400"
        : kind === "bool"
          ? "text-violet-600 dark:text-violet-400"
          : "text-muted-foreground";
  return (
    <div className={cn("flex items-center gap-1 py-0.5", !root && "ml-3 border-l border-border/60 pl-2")}>
      {!root && (
        <>
          <span className="h-3 w-3" />
          <Icon className="h-3 w-3 text-muted-foreground" />
        </>
      )}
      {label && <span className="font-mono text-foreground">{label}:</span>}
      <span className={cn("font-mono", color)}>
        {kind === "string" ? `"${value}"` : value}
      </span>
    </div>
  );
}
