import { afterEach, describe, expect, test } from "bun:test";

import { localInputFailure, requestArchifyRender } from "./render-request";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const input = { type: "architecture" as const, quality: "showcase" as const, source: "{\"diagram_type\":\"architecture\"}" };

function respond(body: unknown, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

describe("localInputFailure", () => {
  test("answers invalid JSON without a network request", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fetch must not be called for invalid JSON");
    }) as unknown as unknown as typeof fetch;
    const outcome = await requestArchifyRender({ ...input, source: "{\"diagram_type\":" }, new AbortController().signal);
    expect(outcome).not.toBeNull();
    if (outcome === null || outcome.ok) throw new Error("expected a failure");
    expect(outcome.stage).toBe("input");
    expect(outcome.diagnostics[0]?.code).toBe("input/json-syntax");
  });

  test("passes valid JSON through", () => {
    expect(localInputFailure("{}")).toBeNull();
  });
});

describe("requestArchifyRender", () => {
  test("posts the draft as JSON and returns the server's result unchanged", async () => {
    let sent: { method?: string; body?: string; contentType?: string | null } = {};
    const served = { ok: false, stage: "input", message: "rejected", diagnostics: [], cached: false };
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("/api/archify/render");
      sent = {
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
        contentType: new Headers(init?.headers).get("content-type"),
      };
      return new Response(JSON.stringify(served), { status: 422, headers: { "content-type": "application/json" } });
    }) as unknown as unknown as typeof fetch;

    const outcome = await requestArchifyRender(input, new AbortController().signal);
    expect(sent.method).toBe("POST");
    expect(sent.contentType).toBe("application/json");
    expect(JSON.parse(sent.body ?? "{}")).toEqual(input);
    expect(outcome).toEqual(served as never);
  });

  test("maps a network failure to a runtime failure", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as unknown as typeof fetch;
    const outcome = await requestArchifyRender(input, new AbortController().signal);
    expect(outcome?.ok).toBe(false);
    if (outcome?.ok === false) expect(outcome.stage).toBe("runtime");
  });

  test("maps an unrecognised response body to a runtime failure", async () => {
    respond({ unexpected: true }, 500);
    const outcome = await requestArchifyRender(input, new AbortController().signal);
    expect(outcome?.ok).toBe(false);
    if (outcome?.ok === false) expect(outcome.message).toContain("HTTP 500");
  });

  test("returns null when the request was superseded", async () => {
    const controller = new AbortController();
    globalThis.fetch = (async () => {
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as unknown as unknown as typeof fetch;
    expect(await requestArchifyRender(input, controller.signal)).toBeNull();
  });
});
