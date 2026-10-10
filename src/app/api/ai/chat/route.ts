import { NextRequest } from "next/server";
import {
  getDefaultModel,
  errorMessage,
  getOpenAICompatible,
} from "@/lib/ai/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface Selection {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

interface ChatContext {
  filePath?: string;
  languageId?: string;
  adapterId?: string;
  selection?: Selection;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  model?: string;
  context?: ChatContext;
}

/**
 * Build the system prompt that frames the assistant as the Workbench AI
 * assistant and (optionally) makes it format- and selection-aware.
 */
function buildSystemPrompt(context?: ChatContext): string {
  const parts: string[] = [
    "You are the Workbench AI assistant, an in-editor helper embedded in a",
    "browser-based local-first document editor (a VS Code-style workbench).",
    "You help the user understand, edit, convert, and improve their",
    "documents. Be concise and correct. When you suggest code, return it",
    "in fenced code blocks with the appropriate language tag.",
  ];

  if (context?.adapterId) {
    parts.push(
      `The user is currently working with a "${context.adapterId}" document. ` +
      "Tailor your answers to that format when relevant."
    );
  }
  if (context?.languageId) {
    parts.push(`Editor language id: ${context.languageId}.`);
  }
  if (context?.filePath) {
    parts.push(`Active file: ${context.filePath}.`);
  }
  if (context?.selection) {
    const s = context.selection;
    parts.push(
      `The user is asking about the current selection spanning lines ` +
      `${s.startLine}-${s.endLine} (columns ${s.startColumn}-${s.endColumn}). ` +
      "Treat the question as referring to that span unless the user says otherwise."
    );
  }

  return parts.join(" ");
}

/**
 * POST /api/ai/chat
 *
 * Body: { messages: {role, content}[], model?, context? }
 *
 * Returns a Server-Sent Events stream. Each chunk is a single `data:` line
 * containing JSON `{ delta: string }` for incremental content, or
 * `{ delta: "", done: true }` for the final content frame, followed by the
 * sentinel `data: [DONE]`. On error mid-stream we emit
 * `data: {"error":"..."}\n\n` before the sentinel so clients can surface
 * the failure cleanly.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Invalid JSON body: ${errorMessage(err)}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!body?.messages || !Array.isArray(body.messages)) {
    return new Response(
      JSON.stringify({ error: "`messages` array is required." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const systemPrompt = buildSystemPrompt(body.context);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...body.messages,
  ];
  const model = body.model || getDefaultModel();

  const headers = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        const openai = getOpenAICompatible();
        const upstream = await openai.chat.completions.create({
          model,
          messages,
          stream: true,
        });

        for await (const chunk of upstream) {
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            send({ delta });
          }
        }
        send({ delta: "", done: true });
      } catch (err) {
        send({ error: errorMessage(err) });
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers });
}
