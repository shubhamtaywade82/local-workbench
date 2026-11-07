// Browser transport for the AI task endpoint. It posts one request, reads the
// event stream, and hands each event to the caller in order. Refusals (HTTP
// 4xx/5xx) become AiRequestError with the server's code and field issues.

import type { AiErrorCode, AiTaskEvent, AiTaskRequest } from "../tasks/contract";
import { AI_TASK_ENDPOINT } from "../tasks/endpoint";

import { createSseDecoder } from "./sse";

export class AiRequestError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly issues: readonly { path: string; message: string }[] = []
  ) {
    super(message);
    this.name = "AiRequestError";
  }
}

export interface RunTaskOptions {
  readonly signal: AbortSignal;
  readonly onEvent: (event: AiTaskEvent) => void;
  readonly fetchImpl?: typeof fetch;
}

const EVENT_TYPES = new Set(["status", "delta", "result", "error"]);

function asEvent(value: unknown): AiTaskEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && EVENT_TYPES.has(type) ? (value as AiTaskEvent) : null;
}

/**
 * Resolves when the stream ends. Throws AiRequestError for refusals and
 * transport failures, and a DOMException named AbortError when cancelled.
 */
export async function runAiTask(request: AiTaskRequest, options: RunTaskOptions): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(AI_TASK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new AiRequestError("internal", `The AI endpoint could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok || !response.body) {
    throw await refusalOf(response);
  }

  const decoder = createSseDecoder<AiTaskEvent>(asEvent);
  const reader = response.body.getReader();
  const text = new TextDecoder();
  let terminal = false;
  const dispatch = (events: AiTaskEvent[]): void => {
    for (const event of events) {
      if (event.type === "result" || event.type === "error") terminal = true;
      options.onEvent(event);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    dispatch(decoder.push(text.decode(value, { stream: true })));
  }
  dispatch(decoder.push(text.decode()));
  dispatch(decoder.flush());

  if (!terminal && !options.signal.aborted) {
    throw new AiRequestError("internal", "The response ended before the task finished.");
  }
}

async function refusalOf(response: Response): Promise<AiRequestError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: fall through to the status text.
  }
  const record = (body ?? {}) as { error?: unknown; code?: unknown; issues?: unknown };
  const code = typeof record.code === "string" ? (record.code as AiErrorCode) : "internal";
  const message = typeof record.error === "string" ? record.error : `The AI endpoint answered ${response.status}.`;
  const issues = Array.isArray(record.issues)
    ? (record.issues as { path: string; message: string }[]).filter((i) => typeof i?.path === "string")
    : [];
  return new AiRequestError(code, message, issues);
}
