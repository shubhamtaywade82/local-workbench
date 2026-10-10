import { NextRequest, NextResponse } from "next/server";
import {
  getDefaultModel,
  errorMessage,
  extractJson,
  getOpenAICompatible,
  stripCodeFence,
} from "@/lib/ai/server";
import { getGenerativeUiPrompt, isGenerativeUiEnabled } from "@/lib/ai/generative-ui/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExplainRequestBody {
  filePath?: string;
  languageId?: string;
  adapterId?: string;
  source: string;
  selection?: {
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
  };
  /** Client opt-in; honoured only when the server has AI_GENERATIVE_UI enabled. */
  generativeUi?: boolean;
}

interface ExplainResponse {
  explanation: string;
  ambiguity: string[];
  /** "openui": `explanation` is text with ```openui-lang blocks. Absent = plain text. */
  format?: "openui";
}

/**
 * POST /api/ai/explain
 *
 * Body: { filePath, languageId, adapterId, source, selection? }
 *
 * Returns `{ explanation, ambiguity }`. The model is instructed to return a
 * JSON object; if the response can't be parsed we degrade gracefully to
 * returning the raw text as `explanation` with an empty `ambiguity` array.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: ExplainRequestBody;
  try {
    body = (await req.json()) as ExplainRequestBody;
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

  const contextParts: string[] = [];
  if (body.adapterId) contextParts.push(`Document format: ${body.adapterId}.`);
  if (body.languageId) contextParts.push(`Language id: ${body.languageId}.`);
  if (body.filePath) contextParts.push(`File path: ${body.filePath}.`);
  if (body.selection) {
    const s = body.selection;
    contextParts.push(
      `Selection: lines ${s.startLine}-${s.endLine}, columns ${s.startColumn}-${s.endColumn}.`
    );
  }

  const systemPrompt = [
    "You are the Workbench AI assistant. Explain what the user's document",
    "does at a high level — its purpose, structure, and any non-obvious",
    "behaviour. Be precise and reference specific elements (keys, sections,",
    "declarations) when useful.",
    ...(contextParts.length ? ["", ...contextParts] : []),
    "",
    "Respond STRICTLY as a JSON object with this exact shape (no prose, no",
    "code fence):",
    "{",
    '  "explanation": "string — 2-4 paragraphs of plain-text explanation.",',
    '  "ambiguity": ["string", ...] — a list of 0..n points where the',
    "    document's meaning is ambiguous, underspecified, or potentially",
    "    incorrect. Empty array if nothing is ambiguous.",
    "}",
  ].join("\n");

  if (body.generativeUi === true && isGenerativeUiEnabled()) {
    return explainAsGenerativeUi(body.source, contextParts);
  }

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

    const parsed = extractJson<ExplainResponse>(raw);
    if (
      parsed &&
      typeof parsed.explanation === "string" &&
      Array.isArray(parsed.ambiguity)
    ) {
      return NextResponse.json({
        explanation: parsed.explanation,
        ambiguity: parsed.ambiguity
          .filter((a) => typeof a === "string")
          .map((a) => a as string),
      });
    }

    // Fallback: return the (fence-stripped) raw text as the explanation.
    return NextResponse.json({
      explanation: stripCodeFence(raw),
      ambiguity: [] as string[],
    });
  } catch (err) {
    return NextResponse.json(
      { error: errorMessage(err) },
      { status: 500 }
    );
  }
}

/**
 * Generative-UI variant: one short text summary plus a single openui-lang
 * block (overview facts, structure, ambiguity callouts). Returned verbatim;
 * the client renders it and falls back to source text if it does not parse.
 */
async function explainAsGenerativeUi(source: string, contextParts: string[]): Promise<Response> {
  const systemPrompt = [
    "You are the Workbench AI assistant. Explain what the user's document",
    "does at a high level — its purpose, structure, and any non-obvious",
    "behaviour. Reference specific keys, sections or declarations.",
    ...(contextParts.length ? ["", ...contextParts] : []),
    "",
    "Answer with ONE short plain-text sentence, then exactly ONE openui-lang",
    "block containing: a Card titled \"Overview\" (KeyValue facts), a Card",
    "titled \"Structure\" (Text and/or Table), and one Callout with",
    "tone=\"warning\" per ambiguous, underspecified or likely-incorrect point.",
    "Do not use ProposedEdit in explanations.",
    "",
    getGenerativeUiPrompt(),
  ].join("\n");

  try {
    const openai = getOpenAICompatible();
    const result = await openai.chat.completions.create({
      model: getDefaultModel(),
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: source },
      ],
    });
    const raw = result?.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({
      explanation: raw,
      ambiguity: [],
      format: "openui",
    } satisfies ExplainResponse);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
