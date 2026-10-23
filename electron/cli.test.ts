import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCliArgs, resolveTarget } from "./cli";
import type { WslInfo } from "./platform";

describe("parseCliArgs", () => {
  const cwd = "/work/current";

  test("no arguments opens the app without a target", () => {
    expect(parseCliArgs([], cwd)).toEqual({ kind: "open", targets: [], newWindow: false });
  });

  test("resolves relative paths against the invoking directory", () => {
    expect(parseCliArgs(["."], cwd)).toEqual({ kind: "open", targets: ["/work/current"], newWindow: false });
    expect(parseCliArgs(["../notes"], cwd)).toEqual({ kind: "open", targets: ["/work/notes"], newWindow: false });
  });

  test("keeps absolute paths and paths containing spaces intact", () => {
    expect(parseCliArgs(["/home/me/My Projects/crypto agent"], cwd)).toEqual({
      kind: "open",
      targets: ["/home/me/My Projects/crypto agent"],
      newWindow: false,
    });
  });

  test("--new-window is a flag that applies to the whole invocation", () => {
    expect(parseCliArgs(["--new-window", "/a"], cwd)).toEqual({
      kind: "open",
      targets: ["/a"],
      newWindow: true,
    });
  });

  test("help and version short-circuit", () => {
    expect(parseCliArgs(["/a", "--help"], cwd)).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"], cwd)).toEqual({ kind: "help" });
    expect(parseCliArgs(["--version"], cwd)).toEqual({ kind: "version" });
    expect(parseCliArgs(["-v"], cwd)).toEqual({ kind: "version" });
  });

  test("rejects unknown options instead of treating them as paths", () => {
    expect(parseCliArgs(["--frob"], cwd)).toEqual({ kind: "error", message: "unknown option: --frob" });
  });

  test("after --, a dash-prefixed name is a path", () => {
    expect(parseCliArgs(["--", "--notes"], cwd)).toEqual({
      kind: "open",
      targets: ["/work/current/--notes"],
      newWindow: false,
    });
  });

  test("a lone dash is a path, not an option", () => {
    expect(parseCliArgs(["-"], cwd)).toEqual({ kind: "open", targets: ["/work/current/-"], newWindow: false });
  });

  test("inside WSL, Windows drive paths become /mnt paths before resolution", () => {
    const wsl: WslInfo = { distro: "Ubuntu", hasDisplay: true };
    expect(parseCliArgs(["C:\\Users\\me\\app"], "/home/me", wsl)).toEqual({
      kind: "open",
      targets: ["/mnt/c/Users/me/app"],
      newWindow: false,
    });
  });

  test("inside WSL, a \\\\wsl.localhost path into this distribution opens the Linux folder", () => {
    const wsl: WslInfo = { distro: "Ubuntu", hasDisplay: true };
    expect(parseCliArgs(["\\\\wsl.localhost\\Ubuntu\\home\\me\\app"], "/", wsl)).toEqual({
      kind: "open",
      targets: ["/home/me/app"],
      newWindow: false,
    });
  });

  test("inside WSL, a path in another distribution is reported as an error", () => {
    const wsl: WslInfo = { distro: "Ubuntu", hasDisplay: true };
    const result = parseCliArgs(["\\\\wsl.localhost\\Debian\\x"], "/", wsl);
    expect(result.kind).toBe("error");
  });

  test("outside WSL, Windows-looking arguments are not rewritten", () => {
    expect(parseCliArgs(["C:\\x"], "/home/me")).toEqual({ kind: "open", targets: ["/home/me/C:\\x"], newWindow: false });
  });

  test("rejects an empty argument and NUL bytes", () => {
    expect(parseCliArgs([""], cwd)).toEqual({ kind: "error", message: "empty path argument" });
    expect(parseCliArgs(["a\u0000b"], cwd)).toEqual({ kind: "error", message: "path contains a NUL byte" });
  });
});

describe("resolveTarget", () => {
  let base: string;

  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), "lw-cli-"));
    mkdirSync(path.join(base, "my project", "docs"), { recursive: true });
    writeFileSync(path.join(base, "my project", "docs", "plan.md"), "# plan\n");
    mkdirSync(path.join(base, "elsewhere"));
    writeFileSync(path.join(base, "elsewhere", "target.md"), "x");
    symlinkSync(path.join(base, "elsewhere", "target.md"), path.join(base, "my project", "link.md"));
    symlinkSync(path.join(base, "elsewhere"), path.join(base, "dirlink"));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  test("a directory with spaces becomes the root", async () => {
    const dir = path.join(base, "my project");
    expect(await resolveTarget(dir)).toEqual({ rootPath: dir, openFile: null });
  });

  test("a file uses its containing directory as the root", async () => {
    const file = path.join(base, "my project", "docs", "plan.md");
    expect(await resolveTarget(file)).toEqual({
      rootPath: path.join(base, "my project", "docs"),
      openFile: "plan.md",
    });
  });

  test("a symlink to a file resolves to the target's directory", async () => {
    const link = path.join(base, "my project", "link.md");
    expect(await resolveTarget(link)).toEqual({
      rootPath: path.join(base, "elsewhere"),
      openFile: "target.md",
    });
  });

  test("a symlink to a directory resolves to the real directory", async () => {
    expect(await resolveTarget(path.join(base, "dirlink"))).toEqual({
      rootPath: path.join(base, "elsewhere"),
      openFile: null,
    });
  });

  test("a missing path fails with a clear message", async () => {
    await expect(resolveTarget(path.join(base, "does-not-exist"))).rejects.toThrow(/no such file or directory/);
  });
});
