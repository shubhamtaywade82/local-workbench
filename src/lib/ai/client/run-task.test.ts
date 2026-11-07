import { describe, expect, test } from "bun:test";

import type { AiTaskEvent, AiTaskRequest } from "../tasks/contract";

import { AiRequestError, runAiTask } from "./run-task";

const request: AiTaskRequest = { task: "chat", messages: [{ role: "user", content: "hi" }] };

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const fetchReturning = (response: Response): typeof fetch => (async () => response) as unknown as typeof fetch;

describe("runAiTask", () => {
  test("delivers every event in order and posts the request as JSON", async () => {
    const received: AiTaskEvent[] = [];
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body) });
      return new Response(
        streamOf(['data: {"type":"status","message":"Thinking"}\n\ndata: {"type":"delta","text":"Hi"}\n\n', 'data: {"type":"result","result":{"kind":"text","text":"Hi","generativeUi":false}}\n\n']),
        { headers: { "content-type": "text/event-stream" } }
      );
    }) as unknown as typeof fetch;

    await runAiTask(request, { signal: new AbortController().signal, onEvent: (e) => received.push(e), fetchImpl });
    expect(received.map((e) => e.type)).toEqual(["status", "delta", "result"]);
    expect(calls[0]?.url).toBe("/api/ai/task");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual(request);
  });

  test("turns a refusal into an AiRequestError with the server's code and issues", async () => {
    const refusal = Response.json(
      { error: "The request is malformed.", code: "invalid-request", issues: [{ path: "task", message: "bad" }] },
      { status: 400 }
    );
    const error = await runAiTask(request, { signal: new AbortController().signal, onEvent: () => {}, fetchImpl: fetchReturning(refusal) }).catch((e) => e);
    expect(error).toBeInstanceOf(AiRequestError);
    expect(error).toMatchObject({ code: "invalid-request", message: "The request is malformed.", issues: [{ path: "task", message: "bad" }] });
  });

  test("reports a stream that ends before its result", async () => {
    const response = new Response(streamOf(['data: {"type":"delta","text":"half"}\n\n']), { headers: { "content-type": "text/event-stream" } });
    const error = await runAiTask(request, { signal: new AbortController().signal, onEvent: () => {}, fetchImpl: fetchReturning(response) }).catch((e) => e);
    expect(error).toBeInstanceOf(AiRequestError);
  });

  test("ends quietly when cancelled before the stream finishes", async () => {
    const controller = new AbortController();
    const response = new Response(streamOf(['data: {"type":"delta","text":"part"}\n\n']), { headers: { "content-type": "text/event-stream" } });
    controller.abort();
    await runAiTask(request, { signal: controller.signal, onEvent: () => {}, fetchImpl: fetchReturning(response) }).catch(() => undefined);
    expect(controller.signal.aborted).toBe(true);
  });
});
