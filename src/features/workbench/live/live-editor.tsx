// Live view for the active document. A Markdown document is rendered block by
// block with inline editing and AI suggestions. Edits go to the same draft the
// Monaco editor uses, so Code and Live always show one document. Other formats
// show the read-only preview.

"use client";

import { useMemo, useState } from "react";
import { useWorkbench } from "@/features/workbench/store";
import { PreviewPane } from "@/features/workbench/preview/preview-pane";
import { documentRegistry } from "@/documents/core/registry";
import {
  applyBlockEdit,
  parseMarkdownBlocks,
  type MarkdownBlock,
} from "@/documents/adapters/markdown/blocks";
import { BlockEditor, LiveBlock, type BlockSuggestion } from "./live-block";

interface EditTarget {
  /** Identifies the block being edited: its offset and text when editing began. */
  start: number;
  source: string;
  /** The textarea contents. */
  text: string;
}

export function LiveEditor() {
  const session = useWorkbench((s) => (s.activeTab ? s.sessions[s.activeTab] : null));
  if (!session || documentRegistry.resolve(session.path).id !== "markdown") {
    return <PreviewPane />;
  }
  return <MarkdownLive key={session.path} path={session.path} draft={session.draftText} />;
}

function MarkdownLive({ path, draft }: { path: string; draft: string }) {
  const updateDraft = useWorkbench((s) => s.updateDraft);
  const blocks = useMemo(() => parseMarkdownBlocks(draft), [draft]);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, BlockSuggestion>>({});

  // Writes `replacement` into the block's range of the latest draft. Returns
  // false when the document changed under the block, so nothing is overwritten.
  function commit(block: MarkdownBlock, replacement: string): boolean {
    const session = useWorkbench.getState().sessions[path];
    if (!session) return false;
    const result = applyBlockEdit(session.draftText, block, replacement);
    if (!result.ok) return false;
    updateDraft(path, result.text);
    return true;
  }

  function startEdit(block: MarkdownBlock) {
    setEditError(null);
    setEditing({ start: block.start, source: block.source, text: block.source });
  }

  function cancelEdit() {
    setEditError(null);
    setEditing(null);
  }

  function saveEdit(block: MarkdownBlock) {
    if (!editing) return;
    if (commit(block, editing.text)) {
      setEditError(null);
      setEditing(null);
      return;
    }
    setEditError(
      "This block changed while you were editing. Your text is still here; copy it before cancelling.",
    );
  }

  async function suggest(block: MarkdownBlock) {
    setSuggestions((prev) => ({ ...prev, [block.source]: { status: "loading" } }));
    try {
      const improved = await requestSuggestion(block.source);
      setSuggestions((prev) => ({ ...prev, [block.source]: { status: "ready", improved } }));
    } catch (err) {
      setSuggestions((prev) => ({
        ...prev,
        [block.source]: { status: "error", message: (err as Error).message },
      }));
    }
  }

  function acceptSuggestion(block: MarkdownBlock, improved: string) {
    if (commit(block, improved)) {
      setSuggestions((prev) => withoutKey(prev, block.source));
      return;
    }
    setSuggestions((prev) => ({
      ...prev,
      [block.source]: {
        status: "error",
        message: "This block changed after the suggestion was made. Ask for a new suggestion.",
      },
    }));
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl space-y-1 p-4">
        {blocks.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            This document is empty. Switch to Code to start writing.
          </p>
        )}
        {blocks.map((block, index) => {
          const isEditing =
            editing !== null && editing.start === block.start && editing.source === block.source;
          if (isEditing && editing) {
            return (
              <BlockEditor
                key={index}
                text={editing.text}
                error={editError}
                onChange={(text) => setEditing({ ...editing, text })}
                onSave={() => saveEdit(block)}
                onCancel={cancelEdit}
              />
            );
          }
          const suggestion = suggestions[block.source];
          return (
            <LiveBlock
              key={index}
              block={block}
              suggestion={suggestion}
              onEdit={() => startEdit(block)}
              onSuggest={() => void suggest(block)}
              onAccept={(improved) => acceptSuggestion(block, improved)}
              onDiscard={() => setSuggestions((prev) => withoutKey(prev, block.source))}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Asks the server to rewrite one block. Uses the `improve` action model. */
async function requestSuggestion(source: string): Promise<string> {
  const res = await fetch("/api/ai/improve-docs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, tone: "concise", preserveCodeBlocks: true }),
  });
  const json = (await res.json().catch(() => null)) as { improved?: string; error?: string } | null;
  if (!res.ok || typeof json?.improved !== "string") {
    throw new Error(json?.error ?? `The suggestion request failed (HTTP ${res.status}).`);
  }
  return json.improved;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
