import { NextRequest, NextResponse } from "next/server";
import { createPatch } from "diff";
import {
  getDefaultModel,
  errorMessage,
  getOpenAICompatible,
  stripCodeFence,
} from "@/lib/ai/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ImproveDocsRequestBody {
  source: string;
  preserveCodeBlocks?: boolean;
  tone?: "concise" | "detailed" | "friendly";
}

interface ImproveDocsResponse {
  improved: string;
  diff?: string;
}

const TONE_GUIDE: Record<NonNullable<ImproveDocsRequestBody["tone"]>, string> = {
  concise:
    "Rewrite for brevity: cut filler words, tighten sentences, prefer the active voice. Keep all technical content.",
  detailed:
    "Rewrite for completeness: add clarifying context, expand terse sections, and explain trade-offs where useful.",
  friendly:
    "Rewrite in a friendly, conversational tone while keeping the document technical and accurate.",
};

/**
 * POST /api/ai/improve-docs
 *
 * Body: { source, preserveCodeBlocks?, tone? }
 *
 * Returns `{ improved, diff? }`. The model rewrites the user's Markdown
 * while preserving its structure (headings, lists, tables) and (if
 * `preserveCodeBlocks`) fenced code blocks verbatim. We compute a unified
 * diff between the original and improved text using the `diff` package so
 * the client can show a preview before applying.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: ImproveDocsRequestBody;
  try {
    body = (await req.json()) as ImproveDocsRequestBody;
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

  const tone = body.tone ?? "concise";
  const preserveCodeBlocks = body.preserveCodeBlocks !== false; // default true

  const systemPrompt = [
    "You are the Workbench AI assistant. Rewrite the user's Markdown",
    "document to improve clarity, grammar, and consistency while",
    "preserving its structure: keep all headings, lists, tables, and",
    "links in the same order. Do not remove technical content. Return",
    "ONLY the rewritten Markdown document — no prose, no code fence, no",
    "explanation.",
    preserveCodeBlocks
      ? "IMPORTANT: preserve ALL fenced code blocks (```...```) VERBATIM — do not modify their language tag, contents, or surrounding whitespace."
      : "Code blocks may be lightly edited for clarity if needed.",
    TONE_GUIDE[tone],
  ].join("\n");

  try {
    const openai = getOpenAICompatible();
    const result = await openai.chat.completions.create({
      model: getDefaultModel(),
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: body.source },
      ],
    });

    const raw: string =
      result?.choices?.[0]?.message?.content ??
      (typeof result === "string" ? result : "");

    const improved = stripCodeFence(raw);

    // Compute a unified diff so the client can show a preview.
    let diff: string | undefined;
    try {
      const patch = createPatch(
        "document.md",
        body.source,
        improved,
        "original",
        "improved",
        { context: 3 }
      );
      diff = patch || undefined;
    } catch (err) {
      // Diff is best-effort; if it fails we still return the improved text.
      console.error("[ai/improve-docs] diff failed:", errorMessage(err));
    }

    return NextResponse.json({
      improved,
      ...(diff ? { diff } : {}),
    } satisfies ImproveDocsResponse);
  } catch (err) {
    return NextResponse.json(
      { error: errorMessage(err) },
      { status: 500 }
    );
  }
}
