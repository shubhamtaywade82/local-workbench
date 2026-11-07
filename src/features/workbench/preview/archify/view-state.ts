// Last-good state for the live Archify preview. Pure, so the rule is testable
// without a browser:
//
//  - A verified render replaces the displayed diagram. An identical digest
//    keeps the current revision, so the iframe does not reload.
//  - A failed render never replaces a verified diagram. The failure is shown
//    next to the last verified revision, as archify's own preview does.
//  - Results are applied only for the source text that produced them. The
//    caller discards results for superseded requests before dispatching.

import type { Diagnostic } from "@/documents/core/types";
import type {
  ArchifyDiagnostic,
  ArchifyQualityProfile,
  ArchifyRenderResult,
  ArchifyValidationSummary,
} from "@/lib/archify/contract";

export interface VerifiedRevision {
  readonly revision: number;
  readonly sha256: string;
  readonly html: string;
  readonly quality: ArchifyQualityProfile;
  readonly validation: ArchifyValidationSummary;
}

export interface RenderFailureView {
  readonly stage: string;
  readonly message: string;
  readonly diagnostics: readonly ArchifyDiagnostic[];
}

export interface ArchifyViewState {
  /** Source text of the latest accepted outcome. Differs from the draft while a render is pending. */
  readonly outcomeSource: string | null;
  readonly verified: VerifiedRevision | null;
  readonly failure: RenderFailureView | null;
  readonly revisionCounter: number;
}

export const initialArchifyViewState: ArchifyViewState = {
  outcomeSource: null,
  verified: null,
  failure: null,
  revisionCounter: 0,
};

export interface ArchifyOutcomeEvent {
  readonly type: "outcome";
  readonly source: string;
  readonly outcome: ArchifyRenderResult;
}

export function reduceArchifyView(state: ArchifyViewState, event: ArchifyOutcomeEvent): ArchifyViewState {
  const { outcome, source } = event;

  if (!outcome.ok) {
    return {
      ...state,
      outcomeSource: source,
      failure: { stage: outcome.stage, message: outcome.message, diagnostics: outcome.diagnostics },
    };
  }

  if (state.verified !== null && state.verified.sha256 === outcome.sha256) {
    return { ...state, outcomeSource: source, failure: null };
  }

  const revision = state.revisionCounter + 1;
  return {
    outcomeSource: source,
    revisionCounter: revision,
    verified: {
      revision,
      sha256: outcome.sha256,
      html: outcome.html,
      quality: outcome.quality,
      validation: outcome.validation,
    },
    failure: null,
  };
}

export type ArchifyStatus = "checking" | "verified" | "needs-fix";

/** What the status pill shows for the current draft. */
export function archifyStatus(state: ArchifyViewState, draftSource: string): ArchifyStatus {
  if (state.outcomeSource !== draftSource) return "checking";
  if (state.failure !== null) return "needs-fix";
  if (state.verified !== null) return "verified";
  return "checking";
}

/**
 * The verdict as Problems entries. A failure lists every Archify diagnostic with
 * its rule code. A verified revision lists its composition warnings, so a
 * diagram that passed but needs attention still shows up.
 */
export function archifyDiagnosticsFor(state: ArchifyViewState, filePath: string): Diagnostic[] {
  if (state.failure !== null) {
    const { stage, message, diagnostics } = state.failure;
    if (diagnostics.length === 0) {
      return [{ filePath, severity: "error", message: `[${stage}] ${message}`, source: "archify", code: stage }];
    }
    return diagnostics.map((entry) => ({
      filePath,
      severity: entry.severity,
      message: `[${entry.code}] ${entry.message}${entry.supportedFixes.length > 0 ? ` Fix: ${entry.supportedFixes.join("; ")}` : ""}`,
      source: "archify",
      code: entry.code,
    }));
  }
  if (state.verified !== null) {
    return state.verified.validation.warningDetails.map((warning) => ({
      filePath,
      severity: "warning" as const,
      message: `[${warning.code}] ${warning.message}`,
      source: "archify",
      code: warning.code,
    }));
  }
  return [];
}
