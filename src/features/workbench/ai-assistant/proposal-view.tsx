// An edit proposal: what changes, the diff, and the decision. The diff is
// computed from the text the model saw, so the user reviews exactly that change.

"use client";

import { useMemo } from "react";
import { Check, GitBranch, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWorkbench } from "@/features/workbench/store";
import { diffStats, proposalDiff } from "@/features/workbench/ai/proposal";
import type { EditProposal } from "@/features/workbench/ai/types";
import { cn } from "@/lib/utils";

interface ProposalViewProps {
  readonly messageId: string;
  readonly proposal: EditProposal;
  readonly onApply: (messageId: string) => void;
  readonly onDiscard: (messageId: string) => void;
}

export function ProposalView({ messageId, proposal, onApply, onDiscard }: ProposalViewProps) {
  // True while the document still has the text the model saw. Null when it is not open.
  const current = useWorkbench((s) => {
    if (!proposal.targetPath) return true;
    const session = s.sessions[proposal.targetPath];
    return session ? session.draftText === proposal.baseText : null;
  });
  const patch = useMemo(() => proposalDiff(proposal, proposal.targetPath ?? proposal.newPath ?? "document"), [proposal]);
  const stats = useMemo(() => diffStats(patch), [patch]);
  const open = proposal.status === "open";
  const target = proposal.targetPath ?? proposal.newPath;

  return (
    <section aria-label={`Proposal: ${proposal.label}`} className="mt-2 overflow-hidden rounded-lg border bg-background text-[12px]">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{proposal.label}</span>
        {proposal.deterministic && <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">No model used</span>}
        <span className="font-mono text-[11px] text-muted-foreground">{target ?? "new file"}</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px]">
          <span className="text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
          <span className="text-rose-600 dark:text-rose-400">−{stats.removed}</span>
        </span>
      </header>
      {proposal.description && <p className="px-3 pt-2 text-[12px] text-muted-foreground">{proposal.description}</p>}
      {!proposal.structured && (
        <p role="note" className="mx-3 mt-2 rounded border border-amber-300/70 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          The model did not return structured output. Read the change carefully before applying it.
        </p>
      )}
      {open && current === false && (
        <p role="note" className="mx-3 mt-2 rounded border border-amber-300/70 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          The document has changed since this was suggested. Applying asks first.
        </p>
      )}
      <details className="group mx-3 my-2" open={stats.added + stats.removed <= 40}>
        <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">Show changes</summary>
        <pre className="mt-2 max-h-60 overflow-auto rounded border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
          {patch.split("\n").slice(2).map((line, index) => (
            <span
              key={index}
              className={cn(
                "block whitespace-pre",
                line.startsWith("+") && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
                line.startsWith("-") && "bg-rose-500/10 text-rose-800 dark:text-rose-300",
                line.startsWith("@@") && "text-muted-foreground"
              )}
            >
              {line || " "}
            </span>
          ))}
        </pre>
      </details>
      <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {open ? (
          <>
            <Button size="sm" className="h-7 gap-1.5" onClick={() => onApply(messageId)}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {proposal.targetPath ? "Apply" : "Save as new file"}
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => onDiscard(messageId)}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Discard
            </Button>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {proposal.status === "applied"
              ? proposal.savedPath
                ? `Saved as ${proposal.savedPath}.`
                : `Applied to ${proposal.targetPath}. Undo with Ctrl+Z.`
              : "Discarded."}
          </span>
        )}
      </footer>
    </section>
  );
}
