/// <reference types="bun-types" />
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs, mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseServerFsConfig, type ServerFsConfig, type ServerRoot } from "./config";
import { ServerFsError, normalizeClientPath, resolveInRoot } from "./paths";
import { createDirectory, createFile, listDirectory, readFile, remove, rename, writeFile } from "./ops";

let base: string; // holds root/ and outside/
let rootDir: string;
let outsideDir: string;
let root: ServerRoot;
let config: ServerFsConfig;

async function expectFsError(promise: Promise<unknown>, status: number): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(ServerFsError);
  expect((err as ServerFsError).status as number).toBe(status);
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "server-fs-")));
});
afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
  rootDir = path.join(base, "root");
  outsideDir = path.join(base, "outside");
  await fs.mkdir(path.join(rootDir, "docs"), { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });
  await fs.writeFile(path.join(rootDir, "a.txt"), "hello");
  await fs.writeFile(path.join(rootDir, "docs", "b.md"), "# b");
  await fs.writeFile(path.join(outsideDir, "secret.txt"), "TOP SECRET");
  const parsed = parseServerFsConfig({ WORKSPACE_ROOTS: rootDir, WORKSPACE_MAX_FILE_BYTES: "1024" });
  if (!parsed) throw new Error("config should parse");
  config = parsed;
  root = parsed.roots[0];
});

describe("normalizeClientPath", () => {
  test("strips leading/trailing slashes; empty is the root", () => {
    expect(normalizeClientPath("/docs/b.md/")).toBe("docs/b.md");
    expect(normalizeClientPath("")).toBe("");
    expect(normalizeClientPath("/")).toBe("");
  });

  test.each(["../x", "a/../../x", "a/./b", "a//b", "a\\b", "a\u0000b"])("rejects %p", (p) => {
    expect(() => normalizeClientPath(p)).toThrow(ServerFsError);
  });

  test("rejects non-strings", () => {
    expect(() => normalizeClientPath(42)).toThrow(ServerFsError);
    expect(() => normalizeClientPath(undefined)).toThrow(ServerFsError);
  });
});

describe("symlink containment", () => {
  test("a file symlink pointing outside cannot be read and is hidden from listings", async () => {
    await fs.symlink(path.join(outsideDir, "secret.txt"), path.join(rootDir, "leak.txt"));
    await expectFsError(readFile(root, config, "leak.txt"), 403);
    const names = (await listDirectory(root, "")).map((e) => e.name);
    expect(names).not.toContain("leak.txt");
  });

  test("a directory symlink pointing outside cannot be listed or written through", async () => {
    await fs.symlink(outsideDir, path.join(rootDir, "escape"), "dir");
    await expectFsError(listDirectory(root, "escape"), 403);
    await expectFsError(writeFile(root, config, "escape/new.txt", "x"), 403);
    await expectFsError(createFile(root, config, "escape/deeper/new.txt", "x"), 403);
    await expect(fs.access(path.join(outsideDir, "new.txt"))).rejects.toThrow();
    await expect(fs.access(path.join(outsideDir, "deeper"))).rejects.toThrow();
  });

  test("symlinks that stay inside the root work and are listed", async () => {
    await fs.symlink(path.join(rootDir, "docs"), path.join(rootDir, "docs-link"), "dir");
    expect(await readFile(root, config, "docs-link/b.md")).toBe("# b");
    const entry = (await listDirectory(root, "")).find((e) => e.name === "docs-link");
    expect(entry?.isDirectory).toBe(true);
  });

  test("resolveInRoot rejects a root whose real path was swapped for a symlink to outside", async () => {
    await fs.rm(path.join(rootDir, "docs"), { recursive: true });
    await fs.symlink(outsideDir, path.join(rootDir, "docs"), "dir");
    await expectFsError(resolveInRoot(root, "docs/secret.txt"), 403);
  });
});

describe("readFile", () => {
  test("reads text", async () => {
    expect(await readFile(root, config, "a.txt")).toBe("hello");
  });
  test("404 for missing, 409 for a directory", async () => {
    await expectFsError(readFile(root, config, "nope.txt"), 404);
    await expectFsError(readFile(root, config, "docs"), 409);
  });
  test("413 over the size limit", async () => {
    await fs.writeFile(path.join(rootDir, "big.txt"), "x".repeat(2048));
    await expectFsError(readFile(root, config, "big.txt"), 413);
  });
  test("415 for binary content", async () => {
    await fs.writeFile(path.join(rootDir, "img.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
    await expectFsError(readFile(root, config, "img.bin"), 415);
  });
});

describe("writeFile", () => {
  test("replaces content atomically and leaves no temp files", async () => {
    await writeFile(root, config, "a.txt", "updated");
    expect(await fs.readFile(path.join(rootDir, "a.txt"), "utf8")).toBe("updated");
    expect((await fs.readdir(rootDir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
  test("preserves the existing file mode", async () => {
    await fs.chmod(path.join(rootDir, "a.txt"), 0o640);
    await writeFile(root, config, "a.txt", "x");
    expect((await fs.stat(path.join(rootDir, "a.txt"))).mode & 0o777).toBe(0o640);
  });
  test("creates a missing file", async () => {
    await writeFile(root, config, "docs/new.md", "new");
    expect(await fs.readFile(path.join(rootDir, "docs", "new.md"), "utf8")).toBe("new");
  });
  test("rejects oversize content, directories, the root and non-string contents", async () => {
    await expectFsError(writeFile(root, config, "a.txt", "x".repeat(2048)), 413);
    await expectFsError(writeFile(root, config, "docs", "x"), 409);
    await expectFsError(writeFile(root, config, "", "x"), 400);
    await expectFsError(writeFile(root, config, "a.txt", 42), 400);
    expect(await fs.readFile(path.join(rootDir, "a.txt"), "utf8")).toBe("hello");
  });
});

describe("createFile / createDirectory", () => {
  test("creates parents and refuses to overwrite", async () => {
    await createFile(root, config, "x/y/z.txt", "z");
    expect(await fs.readFile(path.join(rootDir, "x", "y", "z.txt"), "utf8")).toBe("z");
    await expectFsError(createFile(root, config, "x/y/z.txt", "again"), 409);
    expect(await fs.readFile(path.join(rootDir, "x", "y", "z.txt"), "utf8")).toBe("z");
  });
  test("mkdir is recursive and idempotent", async () => {
    await createDirectory(root, "p/q");
    await createDirectory(root, "p/q");
    expect((await fs.stat(path.join(rootDir, "p", "q"))).isDirectory()).toBe(true);
  });
});

describe("rename", () => {
  test("moves a file, creating target parents", async () => {
    await rename(root, "a.txt", "moved/a2.txt");
    expect(await fs.readFile(path.join(rootDir, "moved", "a2.txt"), "utf8")).toBe("hello");
    await expect(fs.access(path.join(rootDir, "a.txt"))).rejects.toThrow();
  });
  test("refuses to overwrite, to move into itself, or to touch the root", async () => {
    await expectFsError(rename(root, "a.txt", "docs/b.md"), 409);
    await expectFsError(rename(root, "docs", "docs/sub"), 400);
    await expectFsError(rename(root, "", "x"), 400);
    await expectFsError(rename(root, "missing.txt", "x.txt"), 404);
  });
});

describe("remove", () => {
  test("deletes files and directories recursively", async () => {
    await remove(root, "a.txt");
    await remove(root, "docs");
    expect(await fs.readdir(rootDir)).toEqual([]);
  });
  test("removes a symlink to a directory without touching its target", async () => {
    await fs.symlink(path.join(rootDir, "docs"), path.join(rootDir, "docs-link"), "dir");
    await remove(root, "docs-link");
    expect(await fs.readFile(path.join(rootDir, "docs", "b.md"), "utf8")).toBe("# b");
  });
  test("a recursive delete never follows symlinks inside the directory", async () => {
    await fs.mkdir(path.join(rootDir, "tree"));
    await fs.symlink(path.join(rootDir, "docs"), path.join(rootDir, "tree", "inner-link"), "dir");
    await remove(root, "tree");
    expect(await fs.readFile(path.join(rootDir, "docs", "b.md"), "utf8")).toBe("# b");
  });
  test("refuses the root; 404 for missing", async () => {
    await expectFsError(remove(root, ""), 400);
    await expectFsError(remove(root, "/"), 400);
    await expectFsError(remove(root, "missing"), 404);
  });
});

describe("parseServerFsConfig", () => {
  test("disabled when unset or empty", () => {
    expect(parseServerFsConfig({})).toBeNull();
    expect(parseServerFsConfig({ WORKSPACE_ROOTS: "  " })).toBeNull();
  });
  test("skips relative, missing, non-directory and filesystem-root entries", () => {
    const cfg = parseServerFsConfig({
      WORKSPACE_ROOTS: ["relative/dir", path.join(base, "missing"), path.join(rootDir, "a.txt"), "/", rootDir].join(","),
    });
    expect(cfg?.roots.map((r) => r.realPath)).toEqual([rootDir]);
  });
  test("disambiguates duplicate basenames and keeps stable ids", async () => {
    const other = path.join(outsideDir, "root");
    await fs.mkdir(other);
    const cfg = parseServerFsConfig({ WORKSPACE_ROOTS: `${rootDir},${other}` });
    expect(cfg?.roots.map((r) => r.name)).toEqual([`root (${path.basename(base)})`, "root (outside)"]);
    expect(parseServerFsConfig({ WORKSPACE_ROOTS: rootDir })?.roots[0].id).toBe(cfg?.roots[0].id);
  });
  test("max file size and extra hosts", () => {
    const cfg = parseServerFsConfig({ WORKSPACE_ROOTS: rootDir, WORKSPACE_ALLOWED_HOSTS: "DevBox.local" });
    expect(cfg?.maxFileBytes).toBe(5 * 1024 * 1024);
    expect(cfg?.allowedHosts.has("devbox.local")).toBe(true);
    expect(cfg?.allowedHosts.has("localhost")).toBe(true);
  });
});
