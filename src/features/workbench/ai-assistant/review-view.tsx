// An architecture review: a summary and one card per deepening candidate. Each
// card shows the files, the problem, the change, the wins, and a before and
// after diagram. "Explore" turns the candidate into a chat about the decision.

"use client";

import { ChevronDown, Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MermaidRenderer } from "@/lib/preview-renderers/mermaid-renderer";
import type { ReviewPayload } from "@/features/workbench/ai/types";
import { cn } from "@/lib/utils";

interface ReviewViewProps {
  readonly messageId: string;
  readonly review: ReviewPayload;
  readonly onExplore: (messageId: string, index: number) => void;
}

const STRENGTH_STYLE: Readonly<Record<string, string>> = {
  Strong: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  "Worth exploring": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  Speculative: "bg-muted text-muted-foreground",
};

export function ReviewView({ messageId, review, onExplore }: ReviewViewProps) {
  return (
    <div className="mt-2 space-y-2">
      {review.candidates.map((candidate, index) => (
        <details key={`${candidate.title}-${index}`} className="group overflow-hidden rounded-lg border bg-background" open={index === 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12px] hover:bg-muted/40">
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            <span className="font-medium">{candidate.title}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STRENGTH_STYLE[candidate.strength])}>{candidate.strength}</span>
            {candidate.dependencyCategory && <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{candidate.dependencyCategory}</span>}
          </summary>
          <div className="space-y-3 border-t px-3 py-3 text-[12px]">
            {candidate.files.length > 0 && (
              <ul className="font-mono text-[11px] text-muted-foreground">
                {candidate.files.map((file) => (
                  <li key={file} className="truncate">
                    {file}
                  </li>
                ))}
              </ul>
            )}
            <p>
              <span className="font-medium">Problem. </span>
              {candidate.problem}
            </p>
            <p>
              <span className="font-medium">Change. </span>
              {candidate.solution}
            </p>
            {candidate.wins.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {candidate.wins.map((win) => (
                  <li key={win}>{win}</li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <figure className="min-w-0 overflow-auto rounded border bg-card p-2">
                <figcaption className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Before</figcaption>
                <MermaidRenderer source={candidate.beforeMermaid} />
              </figure>
              <figure className="min-w-0 overflow-auto rounded border bg-card p-2">
                <figcaption className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">After</figcaption>
                <MermaidRenderer source={candidate.afterMermaid} />
              </figure>
            </div>
            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => onExplore(messageId, index)}>
              <Compass className="h-3.5 w-3.5" aria-hidden="true" />
              Explore this candidate
            </Button>
          </div>
        </details>
      ))}
    </div>
  );
}
