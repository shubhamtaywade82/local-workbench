/// <reference types="bun-types" />
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { promises as fs, mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST } from "./route";
import { GET as GET_ROOTS } from "./roots/route";

let rootDir: string;
let rootId: string;

const ORIGIN = "http://localhost:3000";
const goodHeaders = {
  host: "localhost:3000",
  origin: ORIGIN,
  "x-workbench-fs": "1",
  "content-type": "application/json",
};

function post(body: unknown, headers: Record<string, string> = goodHeaders): Promise<Response> {
  return POST(
    new Request(`${ORIGIN}/api/fs`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function getRoots(headers: Record<string, string> = goodHeaders): Promise<Response> {
  return GET_ROOTS(new Request(`${ORIGIN}/api/fs/roots`, { headers }));
}

beforeAll(async () => {
  rootDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "fs-routes-")));
  await fs.writeFile(path.join(rootDir, "a.txt"), "hello");
  process.env.WORKSPACE_ROOTS = rootDir;
  process.env.WORKSPACE_MAX_FILE_BYTES = "1024";
  const body = (await (await getRoots()).json()) as { roots: { id: string }[] };
  rootId = body.roots[0].id;
});

afterEach(() => {
  process.env.WORKSPACE_ROOTS = rootDir;
});

afterAll(async () => {
  delete process.env.WORKSPACE_ROOTS;
  delete process.env.WORKSPACE_MAX_FILE_BYTES;
  await fs.rm(rootDir, { recursive: true, force: true });
});

describe("feature flag", () => {
  test("both routes 404 when WORKSPACE_ROOTS is unset", async () => {
    delete process.env.WORKSPACE_ROOTS;
    expect((await getRoots()).status).toBe(404);
    expect((await post({ op: "list", root: "x", path: "" })).status).toBe(404);
  });
});

describe("GET /api/fs/roots", () => {
  test("lists ids and names but never real paths", async () => {
    const res = await getRoots();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain(rootDir);
    expect(JSON.parse(text).roots).toEqual([{ id: rootId, name: path.basename(rootDir) }]);
  });
});

describe("request guard", () => {
  test.each([
    ["foreign host (DNS rebinding)", { ...goodHeaders, host: "evil.example:3000", origin: "http://evil.example:3000" }, 403],
    ["LAN IP host", { ...goodHeaders, host: "192.168.1.20:3000", origin: "http://192.168.1.20:3000" }, 403],
    ["origin mismatch", { ...goodHeaders, origin: "http://evil.example" }, 403],
    ["malformed origin", { ...goodHeaders, origin: "not a url" }, 403],
    ["cross-site fetch metadata", { ...goodHeaders, "sec-fetch-site": "cross-site" }, 403],
    ["missing custom header", { host: goodHeaders.host, origin: ORIGIN, "content-type": "application/json" }, 403],
    ["form-encoded body", { ...goodHeaders, "content-type": "application/x-www-form-urlencoded" }, 415],
  ])("rejects %s", async (_name, headers, status) => {
    const res = await post({ op: "read", root: rootId, path: "a.txt" }, headers as Record<string, string>);
    expect(res.status).toBe(status);
    expect(await res.text()).not.toContain("hello");
  });

  test("accepts 127.0.0.1 and [::1] hosts, and requests without Origin (non-browser)", async () => {
    for (const host of ["127.0.0.1:3000", "[::1]:3000"]) {
      const res = await post({ op: "read", root: rootId, path: "a.txt" }, { ...goodHeaders, host, origin: `http://${host}` });
      expect(res.status).toBe(200);
    }
    const { origin: _origin, ...noOrigin } = goodHeaders;
    expect((await post({ op: "read", root: rootId, path: "a.txt" }, noOrigin)).status).toBe(200);
  });

  test("roots endpoint is guarded too", async () => {
    expect((await getRoots({ ...goodHeaders, host: "evil.example" })).status).toBe(403);
  });
});

describe("POST /api/fs operations", () => {
  test("write → read → list → rename → delete round trip", async () => {
    expect((await post({ op: "write", root: rootId, path: "notes/n.md", contents: "# n" })).status).toBe(200);
    const read = await post({ op: "read", root: rootId, path: "notes/n.md" });
    expect(await read.json()).toEqual({ contents: "# n" });
    const list = (await (await post({ op: "list", root: rootId, path: "" })).json()) as { entries: { name: string }[] };
    expect(list.entries.map((e) => e.name)).toEqual(["notes", "a.txt"]);
    expect((await post({ op: "rename", root: rootId, path: "notes/n.md", newPath: "notes/m.md" })).status).toBe(200);
    expect((await post({ op: "delete", root: rootId, path: "notes" })).status).toBe(200);
  });

  test("maps errors to statuses", async () => {
    expect((await post({ op: "read", root: rootId, path: "../etc/passwd" })).status).toBe(400);
    expect((await post({ op: "read", root: rootId, path: "missing" })).status).toBe(404);
    expect((await post({ op: "create", root: rootId, path: "a.txt" })).status).toBe(409);
    expect((await post({ op: "write", root: rootId, path: "big", contents: "x".repeat(2048) })).status).toBe(413);
    expect((await post({ op: "read", root: "not-a-root", path: "a.txt" })).status).toBe(404);
    expect((await post({ op: "chmod", root: rootId, path: "a.txt" })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
  });

  test("rejects an oversized request body before parsing", async () => {
    const res = await post({ op: "write", root: rootId, path: "big", contents: "x".repeat(200 * 1024) });
    expect(res.status).toBe(413);
    await expect(fs.access(path.join(rootDir, "big"))).rejects.toThrow();
  });
});
