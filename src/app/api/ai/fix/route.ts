import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_MODEL,
  errorMessage,
  extractJson,
  getZai,
} from "@/lib/ai/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Diagnostic {
  severity?: "error" | "warning" | "info" | "hint";
  message?: string;
  line?: number;
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  code?: string | number;
  source?: string;
}

interface FixRequestBody {
  filePath?: string;
  languageId?: string;
  adapterId?: string;
  source: string;
  diagnostics: Diagnostic[];
}

interface ProposedEdit {
  label: string;
  description: string;
  newText: string;
  diff?: string;
}

interface FixResponse {
  proposedEdit: ProposedEdit;
}

/**
 * POST /api/ai/fix
 *
 * Body: { filePath, languageId, adapterId, source, diagnostics }
 *
 * Returns `{ proposedEdit: { label, description, newText, diff? } }`. The
 * `newText` field is the FULL corrected document (not a patch). If the
 * model's response can't be parsed as JSON we degrade gracefully and
 * return the raw output as `newText` with a generic label.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: FixRequestBody;
  try {
    body = (await req.json()) as FixRequestBody;
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${errorMessage(err)}` },
      { status: 400 }
    );
  }

  if (typeof body?.source !== "string") {
    return NextResponse.json(
      { error: "`source` string is required." },
      { status: 400 }
    );
  }
  if (!Array.isArray(body?.diagnostics)) {
    return NextResponse.json(
      { error: "`diagnostics` array is required." },
      { status: 400 }
    );
  }

  const contextParts: string[] = [];
  if (body.adapterId) contextParts.push(`Document format: ${body.adapterId}.`);
  if (body.languageId) contextParts.push(`Language id: ${body.languageId}.`);
  if (body.filePath) contextParts.push(`File path: ${body.filePath}.`);

  const diagSummary = body.diagnostics
    .map((d, i) => {
      const loc =
        d.line != null
          ? `line ${d.line}`
          : d.startLine != null
            ? `line ${d.startLine}${d.endLine != null ? `-${d.endLine}` : ""}`
            : "unknown location";
      const sev = d.severity || "error";
      const code = d.code != null ? ` [${d.code}]` : "";
      const src = d.source ? ` (${d.source})` : "";
      return `${i + 1}. ${sev}${src}${code} @ ${loc}: ${d.message ?? ""}`;
    })
    .join("\n");

  const systemPrompt = [
    "You are the Workbench AI assistant. The user has a document with",
    "diagnostics (lint/parse errors). Your job is to produce a corrected",
    "version of the ENTIRE document that resolves every diagnostic while",
    "preserving the user's intent. Do not produce a diff patch — return",
    "the full corrected text in the `newText` field.",
    ...(contextParts.length ? ["", ...contextParts] : []),
    "",
    "Respond STRICTLY as a JSON object with this exact shape (no prose, no",
    "code fence):",
    "{",
    '  "label": "short label (<= 6 words) for the fix",',
    '  "description": "1-2 sentence explanation of what was changed",',
    '  "newText": "the FULL corrected document as a string",',
    '  "diff": "optional unified-diff string between original and fixed"',
    "}",
    "",
    "Diagnostics to resolve:",
    diagSummary || "(none provided)",
  ].join("\n");

  try {
    const zai = await getZai();
    const result = await zai.chat.completions.create({
      model: DEFAULT_MODEL,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: body.source },
      ],
    });

    const raw: string =
      result?.choices?.[0]?.message?.content ??
      (typeof result === "string" ? result : "");

    const parsed = extractJson<ProposedEdit>(raw);
    if (
      parsed &&
      typeof parsed.newText === "string" &&
      typeof parsed.label === "string" &&
      typeof parsed.description === "string"
    ) {
      const proposedEdit: ProposedEdit = {
        label: parsed.label,
        description: parsed.description,
        newText: parsed.newText,
        ...(typeof parsed.diff === "string" && parsed.diff.length > 0
          ? { diff: parsed.diff }
          : {}),
      };
      return NextResponse.json({ proposedEdit } satisfies FixResponse);
    }

    // Fallback: surface the raw model output as the new text.
    return NextResponse.json({
      proposedEdit: {
        label: "Apply AI suggestion",
        description: "The model did not return structured JSON.",
        newText: raw,
      } satisfies ProposedEdit,
    } satisfies FixResponse);
  } catch (err) {
    return NextResponse.json(
      { error: errorMessage(err) },
      { status: 500 }
    );
  }
}
