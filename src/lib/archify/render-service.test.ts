import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ARCHIFY_DIAGRAM_TYPES, type ArchifyDiagramType, type ArchifyRenderResult } from "./contract";
import { createArchifyRenderer, findRemoteBrandCapture } from "./render-service";
import { resolveArchifyRuntime, type ArchifyRuntime } from "./runtime";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const fixtures = path.join(import.meta.dir, "fixtures");

function fixture(name: string): string {
  return fs.readFileSync(path.join(fixtures, name), "utf8");
}

function realRuntime(): ArchifyRuntime {
  const resolved = resolveArchifyRuntime({ cwd: repoRoot, execPath: "node" });
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.runtime;
}

const fixtureFor: Record<ArchifyDiagramType, string> = {
  architecture: "web-app.architecture.json",
  workflow: "agent-tool-call.workflow.json",
  sequence: "async-job-roundtrip.sequence.json",
  dataflow: "event-stream.dataflow.json",
  lifecycle: "deployment-release.lifecycle.json",
  erd: "orders.erd.json",
  tree: "archify-repository.tree.json",
  class: "payments.class.json",
  timeline: "archify-dev-activity.timeline.json",
  waterfall: "checkout-request.waterfall.json",
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function expectSuccess(result: ArchifyRenderResult): asserts result is Extract<ArchifyRenderResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected a verified render, got ${result.stage}: ${result.message}\n${JSON.stringify(result.diagnostics)}`);
  }
}

/** A runtime whose "Archify" never finishes, so timeout and queue behaviour can be tested. */
function sleepingRuntime(root: string): ArchifyRuntime {
  const cli = path.join(root, "bin", "archify.mjs");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "setInterval(() => {}, 1000);\n");
  return { root, cli, nodeBinary: process.execPath };
}

describe("Archify render service: real vendored runtime", () => {
  test("delivers every supported diagram type as verified HTML", async () => {
    const renderer = createArchifyRenderer({ runtime: realRuntime(), timeoutMs: 60_000 });
    for (const type of ARCHIFY_DIAGRAM_TYPES) {
      const source = fixture(fixtureFor[type]);
      const result = await renderer.render({ type, quality: "showcase", source });
      expectSuccess(result);
      expect(result.type).toBe(type);
      expect(result.html.startsWith("<!doctype html>") || result.html.toLowerCase().startsWith("<!doctype html")).toBe(true);
      expect(result.html).toContain("<svg");
      expect(result.sha256).toBe(sha256(result.html));
      expect(result.bytes).toBe(Buffer.byteLength(result.html));
      expect(result.validation.errors).toBe(0);
      expect(result.validation.checksPassed).toBe(result.validation.checkCount);
    }
  }, 180_000);

  test("serves an identical request from the cache", async () => {
    const renderer = createArchifyRenderer({ runtime: realRuntime(), timeoutMs: 60_000 });
    const request = { type: "tree" as const, quality: "showcase" as const, source: fixture(fixtureFor.tree) };
    const first = await renderer.render(request);
    const second = await renderer.render(request);
    expectSuccess(first);
    expectSuccess(second);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.sha256).toBe(first.sha256);
  }, 60_000);

  test("returns Archify's structured diagnostics and no HTML for an invalid document", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archify-test-"));
    try {
      const renderer = createArchifyRenderer({ runtime: realRuntime(), timeoutMs: 60_000, tempRoot });
      const result = await renderer.render({
        type: "architecture",
        quality: "showcase",
        source: fixture("invalid-architecture.json"),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("render");
      expect(result.diagnostics.map((entry) => entry.code)).toContain("schema/enum");
      expect("html" in result).toBe(false);
      expect(JSON.stringify(result)).not.toContain(tempRoot);
      expect(fs.readdirSync(tempRoot)).toEqual([]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 60_000);

  test("refuses a document whose diagram_type differs from the requested type without running Archify", async () => {
    const renderer = createArchifyRenderer({ runtime: realRuntime(), timeoutMs: 60_000 });
    const result = await renderer.render({
      type: "workflow",
      quality: "showcase",
      source: fixture(fixtureFor.architecture),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("input");
    expect(result.diagnostics[0]?.code).toBe("archify/type-mismatch");
  });

  test("refuses a pinned remote brand capture before Archify can fetch it", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archify-fake-"));
    try {
      // If Archify were started, this runtime would sleep until the 30 s timeout. A fast refusal proves nothing ran.
      const renderer = createArchifyRenderer({ runtime: sleepingRuntime(runtimeRoot), timeoutMs: 30_000 });
      const remote = JSON.parse(fixture(fixtureFor.architecture));
      remote.components[0].brand = { url: "https://example.com/logo.svg", sha256: "a".repeat(64) };
      const started = Date.now();
      const result = await renderer.render({ type: "architecture", quality: "showcase", source: JSON.stringify(remote) });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("input");
      expect(result.diagnostics[0]?.code).toBe("brand/remote-capture-disabled");
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("finds remote brand captures at any depth and ignores built-in brand IDs", () => {
    const nested = JSON.stringify({ a: [{ b: { brand: { url: "https://x.test/a.svg", sha256: "0".repeat(64) } } }] });
    expect(findRemoteBrandCapture(nested)).toBe("/a/0/b/brand");
    expect(findRemoteBrandCapture(JSON.stringify({ components: [{ brand: "github" }] }))).toBeNull();
    expect(findRemoteBrandCapture("{not json")).toBeNull();
  });

  test("refuses a malformed request with field-level diagnostics", async () => {
    const renderer = createArchifyRenderer({ runtime: realRuntime() });
    const result = await renderer.render({ type: "pie", quality: "showcase", source: "{}" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("request");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.code.startsWith("request/")).toBe(true);
  });

  test("refuses an oversized document before starting a render", async () => {
    const renderer = createArchifyRenderer({ runtime: realRuntime(), maxSourceBytes: 64 });
    const result = await renderer.render({ type: "architecture", quality: "showcase", source: fixture(fixtureFor.architecture) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("too-large");
  });
});

describe("Archify render service: failure containment", () => {
  test("times out a stuck render, reports it, and removes its workspace", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archify-test-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archify-fake-"));
    try {
      const renderer = createArchifyRenderer({
        runtime: sleepingRuntime(runtimeRoot),
        timeoutMs: 1_000,
        tempRoot,
      });
      const started = Date.now();
      const result = await renderer.render({ type: "architecture", quality: "showcase", source: "{}" });
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("timeout");
      expect(fs.readdirSync(tempRoot)).toEqual([]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test("stops a render when the client disconnects", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archify-test-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archify-fake-"));
    try {
      const renderer = createArchifyRenderer({ runtime: sleepingRuntime(runtimeRoot), timeoutMs: 20_000, tempRoot });
      const controller = new AbortController();
      const pending = renderer.render(
        { type: "architecture", quality: "showcase", source: "{\"a\":1}" },
        { signal: controller.signal }
      );
      setTimeout(() => controller.abort(), 300);
      const result = await pending;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("aborted");
      expect(fs.readdirSync(tempRoot)).toEqual([]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test("answers busy when the queue is full instead of stacking renders", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archify-test-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archify-fake-"));
    try {
      const renderer = createArchifyRenderer({
        runtime: sleepingRuntime(runtimeRoot),
        timeoutMs: 2_000,
        maxConcurrent: 1,
        maxQueued: 0,
        tempRoot,
      });
      const first = renderer.render({ type: "architecture", quality: "showcase", source: "{\"n\":1}" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const second = await renderer.render({ type: "architecture", quality: "showcase", source: "{\"n\":2}" });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.stage).toBe("busy");
      const firstResult = await first;
      expect(firstResult.ok).toBe(false);
      if (!firstResult.ok) expect(firstResult.stage).toBe("timeout");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("Archify runtime resolution", () => {
  test("reports a missing vendored runtime with the restore command", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "archify-empty-"));
    try {
      const resolved = resolveArchifyRuntime({ cwd: empty, execPath: "/usr/bin/bun" });
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.message).toContain("scripts/sync-archify.mjs");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test("runs Archify with Node even when the server runs under Bun", () => {
    const resolved = resolveArchifyRuntime({ cwd: repoRoot, execPath: "/usr/local/bin/bun" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.runtime.nodeBinary).toBe("node");
  });
});
