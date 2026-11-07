import { describe, expect, test } from "bun:test";

import { InMemoryWorkspace } from "@/platform/filesystem/workspace-fs";

import { DEFAULT_SNAPSHOT_BUDGET, priorityOf, snapshotWorkspace } from "./workspace-snapshot";

const files = [
  { path: "node_modules/pkg/index.js", content: "ignored" },
  { path: ".git/HEAD", content: "ignored" },
  { path: "bun.lock", content: "ignored lock" },
  { path: "logo.png", content: "binary-ish" },
  { path: "src/app.ts", content: "export const app = 1;" },
  { path: "src/app.test.ts", content: "test(...)" },
  { path: "README.md", content: "# Project" },
  { path: "package.json", content: "{}" },
];

describe("snapshotWorkspace", () => {
  test("skips generated folders, lock files and binaries", async () => {
    const fs = new InMemoryWorkspace("snap", files);
    const paths = (await snapshotWorkspace(fs)).map((f) => f.path);
    expect(paths).not.toContain("bun.lock");
    expect(paths).not.toContain("logo.png");
    expect(paths.some((p) => p.startsWith("node_modules/") || p.startsWith(".git/"))).toBe(false);
  });

  test("reads orientation documents before source and tests", async () => {
    const fs = new InMemoryWorkspace("snap", files);
    const paths = (await snapshotWorkspace(fs)).map((f) => f.path);
    expect(paths.indexOf("README.md")).toBeLessThan(paths.indexOf("package.json"));
    expect(paths.indexOf("package.json")).toBeLessThan(paths.indexOf("src/app.ts"));
    expect(paths.indexOf("src/app.ts")).toBeLessThan(paths.indexOf("src/app.test.ts"));
  });

  test("respects the total character budget", async () => {
    const big = Array.from({ length: 30 }, (_, i) => ({ path: `src/m${i}.ts`, content: "x".repeat(9_000) }));
    const fs = new InMemoryWorkspace("big", big);
    const excerpts = await snapshotWorkspace(fs, { ...DEFAULT_SNAPSHOT_BUDGET, maxTotalChars: 20_000 });
    const total = excerpts.reduce((sum, e) => sum + e.excerpt.length, 0);
    expect(total).toBeLessThanOrEqual(20_000);
    expect(excerpts.length).toBeGreaterThan(0);
  });

  test("marks files that were truncated", async () => {
    const fs = new InMemoryWorkspace("long", [{ path: "docs/long.md", content: "y".repeat(10_000) }]);
    const [only] = await snapshotWorkspace(fs, { ...DEFAULT_SNAPSHOT_BUDGET, maxFileChars: 500 });
    expect(only.excerpt).toContain("(truncated)");
  });

  test("ranks paths into the documented priorities", () => {
    expect(priorityOf("docs/adr/1.md")).toBe(0);
    expect(priorityOf("package.json")).toBe(1);
    expect(priorityOf("src/a.ts")).toBe(2);
    expect(priorityOf("src/a.test.ts")).toBe(3);
    expect(priorityOf("misc/a.txt")).toBe(4);
  });
});
