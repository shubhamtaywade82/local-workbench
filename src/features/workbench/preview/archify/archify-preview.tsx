// Live Archify diagram preview. Renders the editor draft through the server's
// Archify pipeline and shows the last verified revision while the draft is
// incomplete or invalid. The rendered HTML runs in a sandboxed frame with
// scripts only, so the diagram cannot reach the workbench's origin, storage or
// cookies.

"use client";

import { useEffect, useReducer, useState } from "react";
import { AlertCircle, Download } from "lucide-react";

import {
  ARCHIFY_QUALITY_PROFILES,
  DEFAULT_ARCHIFY_QUALITY,
  type ArchifyDiagramType,
  type ArchifyQualityProfile,
} from "@/lib/archify/contract";
import { cn } from "@/lib/utils";

import { useWorkbench } from "@/features/workbench/store";

import { requestArchifyRender } from "./render-request";
import {
  archifyDiagnosticsFor,
  archifyStatus,
  initialArchifyViewState,
  reduceArchifyView,
  type ArchifyStatus,
  type RenderFailureView,
  type VerifiedRevision,
} from "./view-state";

/** Quiet period after the last edit before the server renders. */
const RENDER_DEBOUNCE_MS = 250;

export interface ArchifyPreviewProps {
  readonly source: string;
  readonly diagramType: ArchifyDiagramType;
  readonly filePath: string;
}

export function ArchifyPreview({ source, diagramType, filePath }: ArchifyPreviewProps) {
  const [quality, setQuality] = useState<ArchifyQualityProfile>(DEFAULT_ARCHIFY_QUALITY);
  const [view, dispatch] = useReducer(reduceArchifyView, initialArchifyViewState);
  const setArchifyDiagnostics = useWorkbench((s) => s.setArchifyDiagnostics);
  const fileName = filePath.split("/").pop() ?? filePath;

  // Publish the verdict to Problems. The store is external state, so this does not set local state in an effect.
  useEffect(() => {
    if (view.outcomeSource === null) return;
    setArchifyDiagnostics(filePath, archifyDiagnosticsFor(view, filePath));
  }, [view, filePath, setArchifyDiagnostics]);

  useEffect(() => {
    // A new draft, type or quality cancels the pending request and any in-flight
    // one, so a superseded outcome can never reach the reducer.
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void requestArchifyRender({ type: diagramType, quality, source }, controller.signal).then((outcome) => {
        if (outcome === null || controller.signal.aborted) return;
        dispatch({ type: "outcome", source, outcome });
      });
    }, RENDER_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [source, diagramType, quality]);

  const status = archifyStatus(view, source);
  const verified = view.verified;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-background/60 px-3 py-1.5 text-[11px]">
        <StatusPill status={status} verified={verified} />
        {verified !== null && verified.validation.warnings > 0 && (
          <WarningsDisclosure verified={verified} />
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-muted-foreground">
            Quality
            <select
              aria-label="Quality profile"
              value={quality}
              onChange={(event) => {
                const next = ARCHIFY_QUALITY_PROFILES.find((profile) => profile === event.target.value);
                if (next) setQuality(next);
              }}
              className="rounded border bg-background px-1 py-0.5 text-[11px] text-foreground"
            >
              {ARCHIFY_QUALITY_PROFILES.map((profile) => (
                <option key={profile} value={profile}>
                  {profile}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={verified === null}
            onClick={() => {
              if (verified !== null) downloadHtml(verified, fileName);
            }}
            className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            Download HTML
          </button>
        </div>
      </div>

      {view.failure !== null && <FailurePanel failure={view.failure} />}

      <div className="relative min-h-0 flex-1">
        {verified !== null ? (
          <iframe
            title={`Archify diagram, revision ${verified.revision}`}
            // Scripts run the viewer. Downloads and clipboard writes serve its export menu.
            // None of these tokens grants access to the workbench's origin.
            sandbox="allow-scripts allow-downloads"
            allow="clipboard-write"
            allowFullScreen
            referrerPolicy="no-referrer"
            srcDoc={verified.html}
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            {view.failure !== null
              ? "Fix the document to see the diagram. The first verified revision appears here."
              : "Rendering the diagram…"}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status, verified }: { status: ArchifyStatus; verified: VerifiedRevision | null }) {
  const label = pillLabel(status, verified);
  const dot =
    status === "verified" ? "bg-emerald-500" : status === "needs-fix" ? "bg-red-500" : "bg-amber-400";
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-foreground"
    >
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", dot)} />
      {label}
    </span>
  );
}

function pillLabel(status: ArchifyStatus, verified: VerifiedRevision | null): string {
  if (status === "verified" && verified !== null) return `Verified · rev ${verified.revision}`;
  if (status === "needs-fix") {
    return verified !== null ? `Needs fix · showing rev ${verified.revision}` : "Needs fix · no verified revision yet";
  }
  return verified !== null ? `Checking · showing rev ${verified.revision}` : "Checking…";
}

function WarningsDisclosure({ verified }: { verified: VerifiedRevision }) {
  const { warnings, warningDetails } = verified.validation;
  return (
    <details className="text-[11px]">
      <summary className="cursor-pointer text-amber-700 dark:text-amber-400">
        {warnings} composition {warnings === 1 ? "warning" : "warnings"}
      </summary>
      <ul className="mt-1 max-h-40 space-y-1.5 overflow-auto rounded border bg-background p-2 text-muted-foreground">
        {warningDetails.map((entry, index) => (
          <li key={`${entry.code}-${index}`}>
            <code className="font-mono text-foreground">{entry.code}</code>
            <span className="ml-1 whitespace-pre-wrap">{entry.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FailurePanel({ failure }: { failure: RenderFailureView }) {
  const hasDiagnostics = failure.diagnostics.length > 0;
  return (
    <section
      role="alert"
      className="max-h-56 shrink-0 overflow-auto border-b border-red-300/70 bg-red-50 px-3 py-2 text-xs text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
    >
      <div className="mb-1 flex items-center gap-1.5 font-semibold">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {stageTitle(failure.stage)}
      </div>
      {!hasDiagnostics && <p className="whitespace-pre-wrap break-words font-mono text-[11px]">{failure.message}</p>}
      {hasDiagnostics && (
        <ul className="space-y-2">
          {failure.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${index}`}>
              <code className="font-mono text-[11px]">{diagnostic.code}</code>
              <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed">{diagnostic.message}</p>
              {diagnostic.supportedFixes.length > 0 && (
                <ul className="mt-0.5 list-disc pl-4 text-[11px] opacity-90">
                  {diagnostic.supportedFixes.map((fix, fixIndex) => (
                    <li key={`${fix}-${fixIndex}`}>Fix: {fix}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function stageTitle(stage: string): string {
  switch (stage) {
    case "input":
      return "The document was not accepted";
    case "request":
      return "The render request was refused";
    case "too-large":
      return "The document is too large to render";
    case "busy":
      return "The renderer is busy";
    case "timeout":
      return "The render timed out";
    case "runtime":
      return "The renderer is unavailable";
    default:
      return `Archify stopped at the ${stage} stage`;
  }
}

/** Saves the verified HTML as a file. The file opens from disk, outside the workbench's origin. */
function downloadHtml(verified: VerifiedRevision, fileName: string): void {
  const stem = fileName.replace(/\.json$/i, "") || "diagram";
  const url = URL.createObjectURL(new Blob([verified.html], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${stem}.html`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
