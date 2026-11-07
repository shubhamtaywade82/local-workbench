// An Archify diagram from the assistant: its verdict, a live preview when
// Archify accepted it, and the decision. The preview runs in the same sandbox as
// the workbench's own Archify preview (scripts only, no workbench origin).

"use client";

import { AlertTriangle, Check, CircleCheck, Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ArchifyProposal } from "@/features/workbench/ai/types";

interface ArchifyViewProps {
  readonly messageId: string;
  readonly proposal: ArchifyProposal;
  readonly hasActiveDocument: boolean;
  readonly onSave: (messageId: string, mode: "new-file" | "replace") => void;
  readonly onDiscard: (messageId: string) => void;
}

export function ArchifyView({ messageId, proposal, hasActiveDocument, onSave, onDiscard }: ArchifyViewProps) {
  const open = proposal.status === "open";
  const verified = proposal.verdict.ok;
  return (
    <section aria-label={`Archify diagram, ${proposal.diagramType}`} className="mt-2 overflow-hidden rounded-lg border bg-background text-[12px]">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
        {verified ? (
          <CircleCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
        )}
        <span className="font-medium">Archify · {proposal.diagramType}</span>
        <span className="text-[11px] text-muted-foreground">
          {verified ? "verified" : "not accepted"} · attempt {proposal.attempts} · {proposal.quality}
        </span>
      </header>

      {proposal.html ? (
        <iframe
          title={`Preview of the ${proposal.diagramType} diagram`}
          sandbox="allow-scripts allow-downloads"
          allow="clipboard-write"
          allowFullScreen
          referrerPolicy="no-referrer"
          srcDoc={proposal.html}
          className="h-64 w-full border-0 bg-white"
        />
      ) : (
        <div className="space-y-2 p-3">
          <p className="text-[12px] text-muted-foreground">Archify did not accept the last attempt. Nothing is shown until it does.</p>
          <ul className="space-y-1.5">
            {proposal.verdict.diagnostics.slice(0, 6).map((d, i) => (
              <li key={`${d.code}-${i}`} className="rounded border border-amber-300/70 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <code className="font-mono">{d.code}</code> {d.message}
                {d.supportedFixes.length > 0 && <span className="block opacity-80">Fix: {d.supportedFixes.join("; ")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {open ? (
          <>
            <Button size="sm" className="h-7 gap-1.5" disabled={!verified} onClick={() => onSave(messageId, "new-file")}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Save as new file
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={!verified || !hasActiveDocument} onClick={() => onSave(messageId, "replace")}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Replace active document
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={() => onDiscard(messageId)}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Discard
            </Button>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">{proposal.status === "saved" ? `Saved as ${proposal.savedPath}.` : "Discarded."}</span>
        )}
      </footer>
    </section>
  );
}
