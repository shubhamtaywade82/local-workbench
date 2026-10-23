import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NativeWorkspace, openRoot } from "./native-fs";
import { ServerFsError } from "../src/lib/server-fs/paths";

async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ServerFsError);
    const actual: number = (err as ServerFsError).status;
    expect(actual).toBe(status);
    return;
  }
  throw new Error(`expected status ${status}, operation succeeded`);
}

describe("NativeWorkspace", () => {
  let base: string;
  let outside: string;
  let ws: NativeWorkspace;
  let rootDir: string;

  beforeEach(async () => {
    base = mkdtempSync(path.join(tmpdir(), "lw-fs-"));
    rootDir = path.join(base, "project");
    outside = path.join(base, "outside");
    mkdirSync(path.join(rootDir, "docs"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(rootDir, "README.md"), "# readme\n");
    writeFileSync(path.join(rootDir, "docs", "plan.md"), "plan\n");
    writeFileSync(path.join(outside, "secret.txt"), "do not read\n");
    symlinkSync(path.join(outside, "secret.txt"), path.join(rootDir, "escape.txt"));
    symlinkSync(outside, path.join(rootDir, "escape-dir"));
    symlinkSync(path.join(rootDir, "README.md"), path.join(rootDir, "inside-link.md"));
    ws = new NativeWorkspace(await openRoot(rootDir), 64);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe("list", () => {
    test("returns directories first, then files, alphabetically", async () => {
      const names = (await ws.list("")).map((e) => `${e.isDirectory ? "d" : "f"}:${e.name}`);
      expect(names).toEqual(["d:docs", "f:inside-link.md", "f:README.md"]);
    });

    test("omits symlinks that point outside the root", async () => {
      const names = (await ws.list("")).map((e) => e.name);
      expect(names).not.toContain("escape.txt");
      expect(names).not.toContain("escape-dir");
    });

    test("lists nested directories with root-relative paths", async () => {
      expect(await ws.list("docs")).toEqual([
        { path: "docs/plan.md", name: "plan.md", isDirectory: false, size: 5, children: undefined },
      ]);
    });

    test("a file is not a directory", async () => {
      await expectStatus(ws.list("README.md"), 400);
    });
  });

  describe("read and write", () => {
    test("round-trips a file", async () => {
      expect(await ws.read("docs/plan.md")).toBe("plan\n");
      await ws.write("docs/plan.md", "plan v2\n");
      expect(readFileSync(path.join(rootDir, "docs", "plan.md"), "utf8")).toBe("plan v2\n");
    });

    test("reading a missing file is 404", async () => {
      await expectStatus(ws.read("missing.md"), 404);
    });

    test("writing to the workspace root is refused", async () => {
      await expectStatus(ws.write("", "x"), 400);
    });

    test("files over the size limit are refused on read and write", async () => {
      writeFileSync(path.join(rootDir, "big.txt"), "x".repeat(65));
      await expectStatus(ws.read("big.txt"), 413);
      await expectStatus(ws.write("README.md", "x".repeat(65)), 413);
      expect(readFileSync(path.join(rootDir, "README.md"), "utf8")).toBe("# readme\n");
    });

    test("size is measured in bytes, not UTF-16 code units", async () => {
      // 22 characters, 2 bytes each in UTF-8 = 44 bytes, under the 64-byte limit.
      await ws.write("utf8.md", "é".repeat(22));
      // 33 characters, 2 bytes each = 66 bytes, over the limit even though it is 33 code units.
      await expectStatus(ws.write("utf8.md", "é".repeat(33)), 413);
    });
  });

  describe("containment", () => {
    test("rejects parent-directory segments", async () => {
      await expectStatus(ws.read("../outside/secret.txt"), 400);
      await expectStatus(ws.write("docs/../../x.txt", "x"), 400);
    });

    test("rejects absolute paths instead of re-rooting them", async () => {
      await expectStatus(ws.read("/README.md"), 400);
      await expectStatus(ws.read(path.join(rootDir, "README.md")), 400);
      await expectStatus(ws.write("C:/Windows/x.txt", "x"), 400);
    });

    test("rejects backslashes and NUL bytes", async () => {
      await expectStatus(ws.read("docs\\plan.md"), 400);
      await expectStatus(ws.read("README.md\u0000.txt"), 400);
    });

    test("a symlink that leaves the root cannot be read, written or listed through", async () => {
      await expectStatus(ws.read("escape.txt"), 403);
      await expectStatus(ws.write("escape.txt", "pwned"), 403);
      await expectStatus(ws.create("escape-dir/new.txt", "pwned"), 403);
      expect(readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("do not read\n");
    });

    test("a symlink that stays inside the root is usable", async () => {
      expect(await ws.read("inside-link.md")).toBe("# readme\n");
    });

    test("deleting an in-root symlink removes only the link", async () => {
      await ws.delete("inside-link.md");
      expect(existsSync(path.join(rootDir, "inside-link.md"))).toBe(false);
      expect(readFileSync(path.join(rootDir, "README.md"), "utf8")).toBe("# readme\n");
    });

    test("deleting a symlink that leaves the root is refused and the target is untouched", async () => {
      await expectStatus(ws.delete("escape.txt"), 403);
      expect(readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("do not read\n");
    });
  });

  describe("create, mkdir, rename, delete", () => {
    test("create makes missing parent directories and refuses to overwrite", async () => {
      await ws.create("notes/2026/today.md", "hello");
      expect(readFileSync(path.join(rootDir, "notes", "2026", "today.md"), "utf8")).toBe("hello");
      await expectStatus(ws.create("README.md", "clobber"), 409);
      expect(readFileSync(path.join(rootDir, "README.md"), "utf8")).toBe("# readme\n");
    });

    test("mkdir creates directories and fails when a file is in the way", async () => {
      await ws.mkdir("a/b/c");
      expect(lstatSync(path.join(rootDir, "a", "b", "c")).isDirectory()).toBe(true);
      await expectStatus(ws.mkdir("README.md"), 409);
    });

    test("rename moves a file and refuses an existing target", async () => {
      await ws.rename("docs/plan.md", "docs/roadmap.md");
      expect(existsSync(path.join(rootDir, "docs", "plan.md"))).toBe(false);
      expect(readFileSync(path.join(rootDir, "docs", "roadmap.md"), "utf8")).toBe("plan\n");
      await expectStatus(ws.rename("docs/roadmap.md", "README.md"), 409);
    });

    test("rename cannot move the root or move something to the root", async () => {
      await expectStatus(ws.rename("", "x"), 400);
      await expectStatus(ws.rename("README.md", ""), 400);
    });

    test("rename and delete cannot escape the root", async () => {
      await expectStatus(ws.rename("README.md", "../moved.md"), 400);
      await expectStatus(ws.delete("../outside/secret.txt"), 400);
      expect(existsSync(path.join(outside, "secret.txt"))).toBe(true);
    });

    test("delete removes a directory tree but never the root", async () => {
      await ws.delete("docs");
      expect(existsSync(path.join(rootDir, "docs"))).toBe(false);
      await expectStatus(ws.delete(""), 400);
    });

    test("deleting a missing entry is 404", async () => {
      await expectStatus(ws.delete("nope.md"), 404);
    });
  });

  describe("external modification detection", () => {
    test("a write is refused when the file changed on disk after it was read", async () => {
      await ws.read("docs/plan.md");
      writeFileSync(path.join(rootDir, "docs", "plan.md"), "edited elsewhere\n");
      utimesSync(path.join(rootDir, "docs", "plan.md"), new Date(), new Date(Date.now() + 5000));
      await expectStatus(ws.write("docs/plan.md", "my edit\n"), 409);
      expect(readFileSync(path.join(rootDir, "docs", "plan.md"), "utf8")).toBe("edited elsewhere\n");
    });

    test("a write is refused when the file was deleted after it was read", async () => {
      await ws.read("docs/plan.md");
      rmSync(path.join(rootDir, "docs", "plan.md"));
      await expectStatus(ws.write("docs/plan.md", "my edit\n"), 409);
    });

    test("consecutive saves by this window succeed", async () => {
      await ws.read("README.md");
      await ws.write("README.md", "first\n");
      await ws.write("README.md", "second\n");
      expect(await ws.read("README.md")).toBe("second\n");
    });

    test("a file never read in this window can be written", async () => {
      await ws.write("README.md", "overwrite without read\n");
      expect(readFileSync(path.join(rootDir, "README.md"), "utf8")).toBe("overwrite without read\n");
    });
  });

  test("input that is not a string is refused", async () => {
    await expectStatus(ws.read(42 as unknown as string), 400);
  });
});

describe("openRoot", () => {
  test("refuses a missing path", async () => {
    await expect(openRoot(path.join(tmpdir(), "lw-missing-" + Date.now()))).rejects.toThrow();
  });

  test("refuses a regular file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lw-root-"));
    const file = path.join(dir, "f.txt");
    writeFileSync(file, "x");
    try {
      await expect(openRoot(file)).rejects.toThrow(/not a directory/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses the filesystem root", async () => {
    await expect(openRoot("/")).rejects.toThrow(/filesystem root/);
  });

  test("derives a stable id from the canonical path", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lw-id-"));
    try {
      const a = await openRoot(dir);
      const b = await openRoot(dir);
      expect(a.id).toBe(b.id);
      expect(a.id).toMatch(/^[0-9a-f]{16}$/);
      expect(a.name).toBe(path.basename(a.realPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("relativeWithin", () => {
  test("returns a forward-slash path for files inside the root", async () => {
    const { relativeWithin } = await import("./native-fs");
    expect(relativeWithin("/work/app", "/work/app/docs/plan.md")).toBe("docs/plan.md");
    expect(relativeWithin("/work/app", "/work/app/README.md")).toBe("README.md");
  });

  test("returns null for files outside the root or sharing only a name prefix", async () => {
    const { relativeWithin } = await import("./native-fs");
    expect(relativeWithin("/work/app", "/work/app-old/plan.md")).toBeNull();
    expect(relativeWithin("/work/app", "/work/other/plan.md")).toBeNull();
    expect(relativeWithin("/work/app", "/work/app")).toBeNull();
  });
});
