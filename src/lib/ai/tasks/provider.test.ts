import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { resetAiClientsForTests } from "../server";

import { createChatProvider, probeAiProvider } from "./provider";

type Seen = { body: Record<string, unknown>; authorization: string | null };
const seen: Seen[] = [];
let server: ReturnType<typeof Bun.serve>;
const savedEnv = { ...process.env };

/** A fake OpenAI-compatible endpoint that speaks the real wire format for streaming and completion. */
function fakeOpenAi(request: Request): Response | Promise<Response> {
  return request.json().then((body: Record<string, unknown>) => {
    seen.push({ body, authorization: request.headers.get("authorization") });
    const chunk = (content: string) =>
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: body.model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;
    if (body.stream === true) {
      const frames = [chunk("Hel"), chunk("lo"), `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`, "data: [DONE]\n\n"];
      return new Response(frames.join(""), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({
      id: "c",
      object: "chat.completion",
      created: 0,
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: "Full reply" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
}

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: fakeOpenAi });
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}/v1`;
  resetAiClientsForTests();
});

afterAll(() => {
  server.stop(true);
  process.env = savedEnv;
  resetAiClientsForTests();
});

describe("OpenAI-compatible chat provider", () => {
  test("streams content deltas from the wire format", async () => {
    seen.length = 0;
    const provider = createChatProvider("test-model");
    let text = "";
    for await (const delta of provider.stream([{ role: "system", content: "s" }, { role: "user", content: "u" }], new AbortController().signal)) {
      text += delta;
    }
    expect(text).toBe("Hello");
    expect(seen[0].body).toMatchObject({ model: "test-model", stream: true });
    expect(seen[0].body.messages).toEqual([{ role: "system", content: "s" }, { role: "user", content: "u" }]);
    expect(seen[0].authorization).toBe("Bearer test-key");
  });

  test("returns the full reply for a completion", async () => {
    const provider = createChatProvider("test-model");
    expect(await provider.complete([{ role: "user", content: "u" }], new AbortController().signal)).toBe("Full reply");
  });

  test("a cancelled stream rejects instead of waiting on the network", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createChatProvider("test-model");
    let failed = false;
    try {
      for await (const _ of provider.stream([{ role: "user", content: "u" }], controller.signal)) {
        // Nothing should arrive after an aborted signal.
      }
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});

describe("provider status", () => {
  test("reports the provider as available when a key is configured", async () => {
    const status = await probeAiProvider("test-model");
    expect(status).toMatchObject({ id: "openai-compatible", available: true, reason: null, model: "test-model" });
  });

  test("explains what to set when no key is configured", async () => {
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const status = await probeAiProvider("test-model");
      expect(status.available).toBe(false);
      expect(status.reason).toContain("OPENAI_API_KEY");
    } finally {
      process.env.OPENAI_API_KEY = key;
    }
  });
});
