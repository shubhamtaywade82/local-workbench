// POST /api/archify/render: renders an Archify IR draft into verified HTML.
//
// The request must be JSON. A cross-origin page cannot send that without a
// CORS preflight, which this route never grants, so other sites cannot drive
// renders. The route never touches the user's files: it only receives the
// draft text, and every Archify run happens in a private temporary directory.

import { NextResponse, type NextRequest } from "next/server";

import {
  ARCHIFY_MAX_REQUEST_BYTES,
  statusForRenderResult,
  type ArchifyRenderFailure,
  type ArchifyRenderResult,
} from "@/lib/archify/contract";
import { getArchifyRenderer } from "@/lib/archify/render-service";
import { resolveArchifyRuntime } from "@/lib/archify/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(result: ArchifyRenderResult | ArchifyRenderFailure): NextResponse<ArchifyRenderResult> {
  return NextResponse.json(result, {
    status: statusForRenderResult(result),
    headers: { "Cache-Control": "no-store" },
  });
}

function refusal(stage: string, message: string): ArchifyRenderFailure {
  return { ok: false, stage, message, diagnostics: [], cached: false };
}

function isJsonRequest(request: NextRequest): boolean {
  const type = request.headers.get("content-type") ?? "";
  return type.split(";")[0]?.trim().toLowerCase() === "application/json";
}

export async function POST(request: NextRequest): Promise<NextResponse<ArchifyRenderResult>> {
  if (!isJsonRequest(request)) {
    return reply(refusal("request", "Send the render request as application/json."));
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ARCHIFY_MAX_REQUEST_BYTES) {
    return reply(refusal("too-large", "The render request is too large."));
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > ARCHIFY_MAX_REQUEST_BYTES) {
    return reply(refusal("too-large", "The render request is too large."));
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(refusal("request", "The render request is not valid JSON."));
  }

  const resolved = resolveArchifyRuntime();
  if (!resolved.ok) return reply(refusal("runtime", resolved.message));

  const renderer = getArchifyRenderer(resolved.runtime);
  const result = await renderer.render(body, { signal: request.signal });
  return reply(result);
}
