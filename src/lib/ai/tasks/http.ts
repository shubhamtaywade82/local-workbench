// HTTP edge of the AI task endpoint: validates the request, runs the task and
// streams its events as server-sent events. Framework-free (Web Request and
// Response only), so it is tested without starting Next.

import {
  AI_MAX_REQUEST_BYTES,
  aiTaskRequestSchema,
  taskRequirementIssues,
  type AiErrorCode,
  type AiTaskEvent,
  type AiTaskRequest,
} from "./contract";
import { runAiTask, type AiTaskDeps } from "./runner";

export type AiTaskDepsFactory = (request: AiTaskRequest) => AiTaskDeps;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function refuse(status: number, code: AiErrorCode, error: string, issues: readonly { path: string; message: string }[] = []): Response {
  return json(status, { error, code, issues });
}

function bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function createAiTaskHandler(makeDeps: AiTaskDepsFactory): (request: Request) => Promise<Response> {
  return async function handle(request: Request): Promise<Response> {
    const contentType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      return refuse(400, "invalid-request", "Send the request as application/json.");
    }
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > AI_MAX_REQUEST_BYTES) {
      return refuse(413, "too-large", "The request is too large.");
    }
    const text = await request.text();
    if (bytes(text) > AI_MAX_REQUEST_BYTES) return refuse(413, "too-large", "The request is too large.");

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(400, "invalid-request", "The request body is not valid JSON.");
    }

    const parsed = aiTaskRequestSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 12).map((issue) => ({
        path: issue.path.join(".") || "request",
        message: issue.message,
      }));
      return refuse(400, "invalid-request", "The request is malformed.", issues);
    }
    const task = parsed.data;
    const requirements = taskRequirementIssues(task);
    if (requirements.length > 0) {
      return refuse(400, "invalid-request", requirements[0].message, requirements);
    }

    return sseResponse((signal) => runAiTask(task, makeDeps(task), signal), request.signal);
  };
}

const encoder = new TextEncoder();

/**
 * Streams events as `data:` frames. The run is cancelled when the client goes
 * away, so no model call outlives the page that asked for it.
 */
export function sseResponse(
  makeEvents: (signal: AbortSignal) => AsyncIterable<AiTaskEvent>,
  clientSignal: AbortSignal
): Response {
  const runController = new AbortController();
  const cancelRun = (): void => runController.abort();
  if (clientSignal.aborted) cancelRun();
  else clientSignal.addEventListener("abort", cancelRun, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: AiTaskEvent): void => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false;
        }
      };
      try {
        for await (const event of makeEvents(runController.signal)) send(event);
      } catch (error) {
        send({ type: "error", code: "internal", message: error instanceof Error ? error.message : String(error) });
      } finally {
        clientSignal.removeEventListener("abort", cancelRun);
        open = false;
        try {
          controller.close();
        } catch {
          // The client already cancelled the stream.
        }
      }
    },
    cancel() {
      cancelRun();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
