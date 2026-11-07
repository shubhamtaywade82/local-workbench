// Browser side of a live render. Invalid JSON is answered locally, without a
// round trip, so a half-typed edit gets an immediate, precise diagnostic.

import {
  ARCHIFY_RENDER_ENDPOINT,
  isArchifyRenderResult,
  type ArchifyDiagramType,
  type ArchifyQualityProfile,
  type ArchifyRenderFailure,
  type ArchifyRenderResult,
} from "@/lib/archify/contract";

export interface ArchifyRenderInput {
  readonly type: ArchifyDiagramType;
  readonly quality: ArchifyQualityProfile;
  readonly source: string;
}

function failure(stage: string, message: string, diagnostics: ArchifyRenderFailure["diagnostics"] = []): ArchifyRenderFailure {
  return { ok: false, stage, message, diagnostics, cached: false };
}

/** A failure for input that is not JSON, or null when the text parses. */
export function localInputFailure(source: string): ArchifyRenderFailure | null {
  try {
    JSON.parse(source);
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown syntax error";
    return failure("input", `The document is not valid JSON: ${reason}`, [
      {
        code: "input/json-syntax",
        severity: "error",
        message: reason,
        supportedFixes: ["fix the JSON syntax; the last verified diagram stays on screen until then"],
      },
    ]);
  }
}

/**
 * Resolves with the server's verdict, or with null when the request was
 * superseded (the signal aborted). Network and protocol problems come back as
 * `runtime` failures, so the preview always has something accurate to show.
 */
export async function requestArchifyRender(
  input: ArchifyRenderInput,
  signal: AbortSignal
): Promise<ArchifyRenderResult | null> {
  const local = localInputFailure(input.source);
  if (local) return local;

  let response: Response;
  try {
    response = await fetch(ARCHIFY_RENDER_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal.aborted) return null;
    const reason = error instanceof Error ? error.message : "network error";
    return failure("runtime", `The workbench server did not answer: ${reason}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (signal.aborted) return null;
    return failure("runtime", `The render response could not be read (HTTP ${response.status}).`);
  }
  if (!isArchifyRenderResult(body)) {
    return failure("runtime", `The render response was not recognised (HTTP ${response.status}).`);
  }
  return body;
}
