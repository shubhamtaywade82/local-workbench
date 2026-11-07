import { describe, expect, test } from "bun:test";

import type { AiTaskEvent } from "./contract";
import { createAiTaskHandler } from "./http";
import type { AiTaskDeps, ChatProvider } from "./runner";

const noProvider: AiTaskDeps = { provider: null, archify: null, generativeUi: false, generativeUiPrompt: "" };

function provider(reply: string): ChatProvider {
  return {
    id: "fake",
    model: "fake",
    async *stream() {
      for (const part of reply.match(/[\s\S]{1,5}/g) ?? []) yield part;
    },
    async complete() {
      return reply;
    },
  };
}

async function frames(response: Response): Promise<AiTaskEvent[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)) as AiTaskEvent);
}

function post(body: unknown, init: { contentType?: string; contentLength?: string; signal?: AbortSignal } = {}): Request {
  const headers: Record<string, string> = { "content-type": init.contentType ?? "application/json" };
  if (init.contentLength) headers["content-length"] = init.contentLength;
  return new Request("http://127.0.0.1:3000/api/ai/task", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

describe("AI task endpoint: refusals", () => {
  const handle = createAiTaskHandler(() => noProvider);

  test("requires a JSON request", async () => {
    const response = await handle(post("{}", { contentType: "text/plain" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid-request" });
  });

  test("rejects a body that is not JSON", async () => {
    const response = await handle(post("{not json"));
    expect(response.status).toBe(400);
  });

  test("returns field-level issues for a malformed request", async () => {
    const response = await handle(post({ task: "teleport" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path)).toContain("task");
  });

  test("names the missing requirement for a well-formed request", async () => {
    const response = await handle(post({ task: "fix" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "fix needs the active document.", code: "invalid-request" });
  });

  test("refuses an oversized request before reading it", async () => {
    const response = await handle(post({ task: "chat" }, { contentLength: "999999999" }));
    expect(response.status).toBe(413);
  });
});

describe("AI task endpoint: event stream", () => {
  test("streams a deterministic conversion as events with no model configured", async () => {
    const handle = createAiTaskHandler(() => noProvider);
    const response = await handle(
      post({
        task: "convert",
        document: { path: "a.json", languageId: "json", adapterId: "json", text: "{\"a\":1}" },
        options: { targetFormat: "yaml" },
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    const events = await frames(response);
    expect(events).toEqual([
      {
        type: "result",
        result: {
          kind: "edit",
          label: "Convert to yaml",
          description: "Converted in-process. No model was used.",
          newText: "a: 1\n",
          structured: true,
          deterministic: true,
        },
      },
    ]);
  });

  test("streams deltas and the final result for chat", async () => {
    const handle = createAiTaskHandler(() => ({ ...noProvider, provider: provider("Hello world") }));
    const response = await handle(post({ task: "chat", messages: [{ role: "user", content: "hi" }] }));
    const events = await frames(response);
    const text = events.filter((e) => e.type === "delta").map((e) => (e.type === "delta" ? e.text : "")).join("");
    expect(text).toBe("Hello world");
    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "text", text: "Hello world", generativeUi: false } });
  });

  test("reports a missing provider as an error event with a next step", async () => {
    const handle = createAiTaskHandler(() => noProvider);
    const events = await frames(await handle(post({ task: "chat", messages: [{ role: "user", content: "hi" }] })));
    expect(events).toEqual([expect.objectContaining({ type: "error", code: "provider-unavailable" })]);
  });

  test("stops the run when the client disconnects", async () => {
    let released = false;
    const stalled: ChatProvider = {
      id: "stalled",
      model: "stalled",
      async *stream(_messages, signal) {
        yield "partial";
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        released = true;
      },
      async complete() {
        throw new Error("unused");
      },
    };
    const client = new AbortController();
    const handle = createAiTaskHandler(() => ({ ...noProvider, provider: stalled }));
    const response = await handle(post({ task: "chat", messages: [{ role: "user", content: "hi" }] }, { signal: client.signal }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    while (!seen.includes("partial")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      seen += decoder.decode(chunk.value);
    }
    expect(seen).toContain("partial");
    client.abort();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(released).toBe(true);
  });
});
