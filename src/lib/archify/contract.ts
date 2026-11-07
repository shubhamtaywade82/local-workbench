// Contract between the workbench preview and the server-side Archify render
// route. This module is pure: the browser and the Node route both import it,
// so it must not import Node built-ins or React.

import { z } from "zod";

/** The ten diagram types Archify's live preview supports. Explainer is excluded. */
export const ARCHIFY_DIAGRAM_TYPES = [
  "architecture",
  "workflow",
  "sequence",
  "dataflow",
  "lifecycle",
  "erd",
  "tree",
  "class",
  "timeline",
  "waterfall",
] as const;

export type ArchifyDiagramType = (typeof ARCHIFY_DIAGRAM_TYPES)[number];

/** Quality gates Archify applies. `showcase` turns composition issues into errors. */
export const ARCHIFY_QUALITY_PROFILES = ["showcase", "standard"] as const;

export type ArchifyQualityProfile = (typeof ARCHIFY_QUALITY_PROFILES)[number];

export const DEFAULT_ARCHIFY_QUALITY: ArchifyQualityProfile = "showcase";

/** Largest IR document the server will render. Archify's examples are a few KB. */
export const ARCHIFY_MAX_SOURCE_BYTES = 1024 * 1024;

/** Largest request body the route reads. JSON escaping can expand the source. */
export const ARCHIFY_MAX_REQUEST_BYTES = 8 * 1024 * 1024;

export const ARCHIFY_RENDER_ENDPOINT = "/api/archify/render";

export function isArchifyDiagramType(value: unknown): value is ArchifyDiagramType {
  return typeof value === "string" && (ARCHIFY_DIAGRAM_TYPES as readonly string[]).includes(value);
}

export function isArchifyQualityProfile(value: unknown): value is ArchifyQualityProfile {
  return typeof value === "string" && (ARCHIFY_QUALITY_PROFILES as readonly string[]).includes(value);
}

export interface ArchifyRenderRequest {
  readonly type: ArchifyDiagramType;
  readonly quality: ArchifyQualityProfile;
  /** The IR document text exactly as it appears in the editor draft. */
  readonly source: string;
}

export const archifyRenderRequestSchema = z
  .object({
    type: z.enum(ARCHIFY_DIAGRAM_TYPES),
    quality: z.enum(ARCHIFY_QUALITY_PROFILES).default(DEFAULT_ARCHIFY_QUALITY),
    source: z.string(),
  })
  .strict();

export interface ArchifyDiagnostic {
  /** Stable rule code from Archify, such as `schema/enum` or `composition/viewport-height`. */
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly supportedFixes: readonly string[];
}

export interface ArchifyWarningDetail {
  readonly code: string;
  readonly message: string;
}

export interface ArchifyValidationSummary {
  readonly checksPassed: number;
  readonly checkCount: number;
  readonly compositionProfile: string;
  readonly compositionStatus: string;
  readonly errors: number;
  readonly warnings: number;
  readonly warningDetails: readonly ArchifyWarningDetail[];
}

export interface ArchifyRenderSuccess {
  readonly ok: true;
  readonly type: ArchifyDiagramType;
  readonly quality: ArchifyQualityProfile;
  /** The verified, self-contained HTML document. Always passed Archify's delivery gates. */
  readonly html: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly cached: boolean;
  readonly validation: ArchifyValidationSummary;
}

/**
 * Why a render did not produce HTML.
 * - `request`, `too-large`: the request itself was refused.
 * - `busy`, `timeout`, `runtime`, `aborted`: the server could not finish.
 * - anything else is the Archify stage that rejected the document (`input`, `render`, `check`, ...).
 */
export interface ArchifyRenderFailure {
  readonly ok: false;
  readonly stage: string;
  readonly message: string;
  readonly diagnostics: readonly ArchifyDiagnostic[];
  readonly cached: boolean;
}

export type ArchifyRenderResult = ArchifyRenderSuccess | ArchifyRenderFailure;

/**
 * HTTP status for a render outcome. A rejected document is a verdict the server
 * answered correctly, so it is 200: an authoring state, not a console error in
 * the browser. Request and infrastructure failures keep their 4xx/5xx codes.
 */
export function statusForRenderResult(result: ArchifyRenderResult): number {
  if (result.ok) return 200;
  switch (result.stage) {
    case "request":
      return 400;
    case "too-large":
      return 413;
    case "busy":
      return 429;
    case "runtime":
      return 503;
    case "timeout":
      return 504;
    case "aborted":
      return 499;
    default:
      return 200;
  }
}

/** Shape check for a response body. The browser treats anything else as a runtime failure. */
export function isArchifyRenderResult(value: unknown): value is ArchifyRenderResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.ok === true) {
    return (
      typeof candidate.html === "string" &&
      typeof candidate.sha256 === "string" &&
      typeof candidate.validation === "object" &&
      candidate.validation !== null
    );
  }
  if (candidate.ok === false) {
    return (
      typeof candidate.stage === "string" &&
      typeof candidate.message === "string" &&
      Array.isArray(candidate.diagnostics)
    );
  }
  return false;
}
