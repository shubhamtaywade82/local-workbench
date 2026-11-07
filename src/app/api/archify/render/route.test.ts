import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { POST } from "./route";

function post(body: string, contentType = "application/json"): NextRequest {
  return new NextRequest("http://127.0.0.1:3000/api/archify/render", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("POST /api/archify/render", () => {
  test("requires a JSON request, so cross-origin pages cannot drive renders", async () => {
    const response = await POST(post("{}", "text/plain"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; stage: string };
    expect(body.ok).toBe(false);
    expect(body.stage).toBe("request");
  });

  test("rejects a body that is not JSON", async () => {
    const response = await POST(post("{not json"));
    expect(response.status).toBe(400);
  });

  test("refuses a body over the request limit", async () => {
    const huge = JSON.stringify({ type: "architecture", quality: "showcase", source: "x".repeat(9 * 1024 * 1024) });
    const response = await POST(post(huge));
    expect(response.status).toBe(413);
  });

  test("returns verified HTML with no-store caching", async () => {
    const fixture = await Bun.file(`${import.meta.dir}/../../../../lib/archify/fixtures/archify-repository.tree.json`).text();
    const response = await POST(post(JSON.stringify({ type: "tree", quality: "showcase", source: fixture })));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { ok: boolean; html: string };
    expect(body.ok).toBe(true);
    expect(body.html).toContain("<svg");
  }, 120_000);

  test("answers a rejected document with 200 and structured diagnostics, not an error status", async () => {
    const fixture = await Bun.file(`${import.meta.dir}/../../../../lib/archify/fixtures/invalid-architecture.json`).text();
    const response = await POST(post(JSON.stringify({ type: "architecture", quality: "showcase", source: fixture })));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; diagnostics: { code: string }[]; html?: string };
    expect(body.ok).toBe(false);
    expect(body.diagnostics.some((entry) => entry.code === "schema/enum")).toBe(true);
    expect(body.html).toBeUndefined();
  }, 120_000);
});
