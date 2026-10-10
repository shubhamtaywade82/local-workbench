/**
 * Server-side helpers for the AI API routes.
 *
 * IMPORTANT: the `z-ai-web-dev-sdk` MUST run on the server only. This module
 * is only imported from App Router route handlers (under `src/app/api/ai/*`)
 * which always run in the Node.js runtime.
 */
import ZAI from "z-ai-web-dev-sdk";

/**
 * Default model used for non-chat completions (explain / fix / convert /
 * generate-diagram / improve-docs). The chat route picks its own model from
 * the request body.
 */
export const DEFAULT_MODEL = "glm-4-plus";

/**
 * Module-level SDK promise. `ZAI.create()` reads `.z-ai-config` from disk;
 * the file is created by the deployment environment (sandbox injects it on
 * boot). If the config is missing, the promise rejects — each route handler
 * awaits it inside a try/catch so the route still returns a clean JSON
 * error response instead of crashing.
 *
 * We intentionally keep this as a module-level promise so we only initialise
 * the SDK once per server process (initialisation is cheap but not free).
 */
export const zaiPromise: Promise<ZAI> = ZAI.create().catch((err) => {
  // Swallow the rejection; handlers will re-await and surface a clean error.
  // We log once at module load so missing-config is visible in server logs.
  console.error("[ai/server] ZAI.create() failed:", err?.message ?? err);
  throw err;
});

/**
 * Resolve the SDK instance. Re-throws whatever `ZAI.create()` rejected with
 * so callers can wrap in their own try/catch.
 */
export async function getZai(): Promise<ZAI> {
  return await zaiPromise;
}

/**
 * An OpenAI-style streaming chunk as emitted by the upstream Z.ai API.
 * The upstream returns a raw `ReadableStream<Uint8Array>` whose bytes form
 * an SSE stream of `data: {...}\n\n` lines, terminated by `data: [DONE]`.
 */
export interface UpstreamChunk {
  choices?: Array<{
    delta?: { content?: string; role?: string };
    finish_reason?: string | null;
  }>;
  id?: string;
  model?: string;
}

/**
 * Decode an upstream `ReadableStream<Uint8Array>` SSE stream into parsed
 * chunk objects. Stops when `data: [DONE]` is encountered or the stream
 * ends. Malformed lines are skipped (the upstream can emit keep-alive
 * comments or partial frames that we don't care about).
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<UpstreamChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line. Lines within an event are
      // joined, but Z.ai only ever sends `data:` lines so we can handle each
      // line independently.
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        if (!data) continue;
        try {
          yield JSON.parse(data) as UpstreamChunk;
        } catch {
          // Skip malformed JSON line — the upstream sometimes emits partial
          // frames during reconnects.
        }
      }
    }
    // Flush any trailing buffered data.
    const trimmed = buffer.trim();
    if (trimmed.startsWith("data:")) {
      const data = trimmed.slice(5).trim();
      if (data && data !== "[DONE]") {
        try {
          yield JSON.parse(data) as UpstreamChunk;
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Strip a leading/trailing Markdown code fence from a model response. Models
 * frequently wrap Mermaid / JSON / YAML output in ``` fences despite being
 * asked not to. We remove at most one outer fence and its optional language
 * tag, preserving everything inside (including nested fences).
 */
export function stripCodeFence(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();
  // Match an opening fence ``` optional-language, content, closing fence.
  const fenceMatch = trimmed.match(/^```[a-zA-Z0-9_+\-]*\s*\n([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

/**
 * Try to extract a JSON object from a model response. We attempt:
 *   1. JSON.parse the whole thing.
 *   2. A fenced ```json ... ``` block.
 *   3. The first balanced `{ ... }` substring.
 * Returns `undefined` if none of the strategies yield valid JSON.
 */
export function extractJson<T = unknown>(text: string): T | undefined {
  if (!text) return undefined;
  const tryParse = (s: string): T | undefined => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return undefined;
    }
  };

  // 1. Direct parse.
  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  // 2. Fenced ```json block.
  const fence = text.match(/```(?:json|JSON)?\s*\n([\s\S]*?)\n?```\s*$/);
  if (fence) {
    const parsed = tryParse(fence[1]);
    if (parsed !== undefined) return parsed;
  }

  // 3. First balanced { ... } (greedy across newlines).
  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          const parsed = tryParse(candidate);
          if (parsed !== undefined) return parsed;
          break;
        }
      }
    }
  }

  return undefined;
}

/**
 * Convert any thrown value into a readable error string.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
