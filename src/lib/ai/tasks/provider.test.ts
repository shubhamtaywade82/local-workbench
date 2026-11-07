import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { parseOllamaEndpoints, resetAiClientsForTests } from "../server";

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

describe("parseOllamaEndpoints", () => {
  test("falls back to default endpoint when no env vars are set", () => {
    const endpoints = parseOllamaEndpoints({});
    expect(endpoints).toEqual([
      { name: "default", baseUrl: "http://localhost:11434", apiKey: undefined, priority: 1 },
    ]);
  });

  test("uses custom OLLAMA_BASE_URL and OLLAMA_API_KEY for default endpoint", () => {
    const endpoints = parseOllamaEndpoints({
      OLLAMA_BASE_URL: "http://custom:11434",
      OLLAMA_API_KEY: "secret-key",
    });
    expect(endpoints).toEqual([
      { name: "default", baseUrl: "http://custom:11434", apiKey: "secret-key", priority: 1 },
    ]);
  });

  test("resolves multiple discrete API keys OLLAMA_API_KEY_1 and OLLAMA_API_KEY_2", () => {
    const endpoints = parseOllamaEndpoints({
      OLLAMA_BASE_URL: "http://localhost:11434",
      OLLAMA_API_KEY_1: "key-1",
      OLLAMA_API_KEY_2: "key-2",
    });
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]).toMatchObject({ name: "ollama-key-1", baseUrl: "http://localhost:11434", apiKey: "key-1", priority: 1 });
    expect(endpoints[1]).toMatchObject({ name: "ollama-key-2", baseUrl: "http://localhost:11434", apiKey: "key-2", priority: 1 });
  });

  test("respects per-key name, models, priority and custom base URL overrides", () => {
    const endpoints = parseOllamaEndpoints({
      OLLAMA_API_KEY_1: "key-cloud",
      OLLAMA_API_KEY_1_NAME: "beam-cloud-key",
      OLLAMA_API_KEY_1_BASE_URL: "https://ollama.com",
      OLLAMA_API_KEY_1_MODELS: "beam:cloud,beam:cloud",
      OLLAMA_API_KEY_1_PRIORITY: "10",
    });
    expect(endpoints).toEqual([
      {
        name: "beam-cloud-key",
        baseUrl: "https://ollama.com",
        apiKey: "key-cloud",
        priority: 10,
        models: ["beam:cloud", "beam:cloud"],
      },
    ]);
  });

  test("resolves comma-separated OLLAMA_API_KEYS", () => {
    const endpoints = parseOllamaEndpoints({
      OLLAMA_BASE_URL: "http://ollama-host:11434",
      OLLAMA_API_KEYS: "key-a, key-b, key-c",
    });
    expect(endpoints).toEqual([
      { name: "ollama-key-1", baseUrl: "http://ollama-host:11434", apiKey: "key-a", priority: 1 },
      { name: "ollama-key-2", baseUrl: "http://ollama-host:11434", apiKey: "key-b", priority: 1 },
      { name: "ollama-key-3", baseUrl: "http://ollama-host:11434", apiKey: "key-c", priority: 1 },
    ]);
  });

  test("resolves comma-separated keys in OLLAMA_API_KEY", () => {
    const endpoints = parseOllamaEndpoints({
      OLLAMA_API_KEY: "key-x, key-y",
    });
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0].apiKey).toBe("key-x");
    expect(endpoints[1].apiKey).toBe("key-y");
  });

  test("OLLAMA_ENDPOINTS takes precedence over discrete keys", () => {
    const endpoints = parseOllamaEndpoints({
      OLLAMA_ENDPOINTS: JSON.stringify([
        { name: "explicit-json", baseUrl: "http://remote:11434", apiKey: "json-key" },
      ]),
      OLLAMA_API_KEY_1: "discrete-key",
    });
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].name).toBe("explicit-json");
  });
});
