// One Markdown block in the live view: rendered, with inline Edit and Suggest
// actions. Clicking the rendered text (outside links) opens the block's source
// for editing. A suggestion from the AI model is shown as a diff with its
// rendered result, and is applied only when the user accepts it.

"use client";

import { diffLines } from "diff";
import { Pencil, Sparkles } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { MarkdownBlock } from "@/documents/adapters/markdown/blocks";
import { MarkdownRenderer } from "@/lib/preview-renderers/markdown-renderer";
import { cn } from "@/lib/utils";

export type BlockSuggestion =
  | { status: "loading" }
  | { status: "ready"; improved: string }
  | { status: "error"; message: string };

interface LiveBlockProps {
  block: MarkdownBlock;
  suggestion: BlockSuggestion | undefined;
  onEdit: () => void;
  onSuggest: () => void;
  onAccept: (improved: string) => void;
  onDiscard: () => void;
}

export function LiveBlock({ block, suggestion, onEdit, onSuggest, onAccept, onDiscard }: LiveBlockProps) {
  return (
    <section className="group relative rounded-md border border-transparent px-3 py-2 hover:border-border hover:bg-muted/30 focus-within:border-border">
      <div
        className="cursor-text"
        onClick={(event) => {
          // Links keep their normal behaviour; the rest of the block opens the editor.
          if ((event.target as HTMLElement).closest("a")) return;
          onEdit();
        }}
      >
        <MarkdownRenderer bare source={block.source} />
      </div>
      <div className="absolute right-1 top-1 hidden items-center gap-1 group-focus-within:flex group-hover:flex">
        <BlockAction label="Edit this block" onClick={onEdit}>
          <Pencil className="h-3 w-3" />
          Edit
        </BlockAction>
        <BlockAction
          label="Suggest an improvement for this block"
          onClick={onSuggest}
          disabled={suggestion?.status === "loading"}
        >
          <Sparkles className="h-3 w-3" />
          {suggestion?.status === "loading" ? "Thinking…" : "Suggest"}
        </BlockAction>
      </div>
      {suggestion && (
        <SuggestionPanel
          suggestion={suggestion}
          original={block.source}
          onAccept={onAccept}
          onDiscard={onDiscard}
        />
      )}
    </section>
  );
}

export function BlockEditor({
  text,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  text: string;
  error: string | null;
  onChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-primary/60 bg-background p-2">
      <div className="grid gap-2 md:grid-cols-2">
        <textarea
          autoFocus
          aria-label="Block source"
          value={text}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onSave();
          }}
          className="min-h-[140px] resize-y rounded border bg-transparent p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-primary"
        />
        <div aria-label="Block preview" className="min-h-[140px] overflow-auto rounded border border-dashed p-2">
          <MarkdownRenderer bare source={text} />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">Ctrl+Enter saves · Esc cancels</span>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded border px-2 py-1">
            Cancel
          </button>
          <button type="button" onClick={onSave} className="rounded bg-primary px-2 py-1 text-primary-foreground">
            Save block
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function SuggestionPanel({
  suggestion,
  original,
  onAccept,
  onDiscard,
}: {
  suggestion: BlockSuggestion;
  original: string;
  onAccept: (improved: string) => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-2 space-y-2 rounded-md border border-primary/40 bg-background p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">AI suggestion</span>
        <div className="flex gap-2">
          {suggestion.status === "ready" && (
            <button
              type="button"
              onClick={() => onAccept(suggestion.improved)}
              className="rounded bg-primary px-2 py-0.5 text-primary-foreground"
            >
              Accept
            </button>
          )}
          <button type="button" onClick={onDiscard} className="rounded border px-2 py-0.5">
            Discard
          </button>
        </div>
      </div>
      {suggestion.status === "loading" && <p className="text-muted-foreground">Asking the model…</p>}
      {suggestion.status === "error" && <p className="text-destructive">{suggestion.message}</p>}
      {suggestion.status === "ready" && (
        <>
          <DiffLines original={original} improved={suggestion.improved} />
          <div className="rounded border border-dashed p-2">
            <MarkdownRenderer bare source={suggestion.improved} />
          </div>
        </>
      )}
    </div>
  );
}

function DiffLines({ original, improved }: { original: string; improved: string }) {
  const parts = useMemo(() => diffLines(original, improved), [original, improved]);
  return (
    <pre className="max-h-48 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
      {parts.map((part, index) => (
        <span
          key={index}
          className={cn(
            part.added && "bg-emerald-500/15 text-emerald-400",
            part.removed && "bg-rose-500/15 text-rose-400 line-through",
          )}
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}
