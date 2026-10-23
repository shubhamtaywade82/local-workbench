// Filesystem operations for the desktop window's workspace. Every client path
// is resolved through the same containment check the web server uses
// (src/lib/server-fs/paths.ts): no `..`, no absolute paths, no symlink that
// leaves the root. The renderer never sends an absolute path.
//
// Also detects external edits: a file's mtime and size are recorded when it is
// read, and a later write is refused if either changed on disk.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceFileEntry } from "../src/documents/core/types";
import type { ServerRoot } from "../src/lib/server-fs/config";
import { resolveInRoot, ServerFsError } from "../src/lib/server-fs/paths";

export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Opens a directory as a workspace root. Throws if it is missing, not a directory, or `/`. */
export async function openRoot(directory: string): Promise<ServerRoot> {
  const realPath = await fs.realpath(directory);
  if (!(await fs.stat(realPath)).isDirectory()) {
    throw new Error(`not a directory: ${path.basename(directory)}`);
  }
  if (realPath === path.parse(realPath).root) {
    throw new Error("refusing to open the filesystem root as a workspace");
  }
  return {
    // Same derivation as src/lib/server-fs/config.ts, so the id is stable
    // across launches for the same folder.
    id: createHash("sha256").update(realPath).digest("hex").slice(0, 16),
    name: path.basename(realPath),
    realPath,
  };
}

interface KnownVersion {
  readonly mtimeMs: number;
  readonly size: number;
}

export class NativeWorkspace {
  private readonly known = new Map<string, KnownVersion>();

  constructor(
    readonly root: ServerRoot,
    private readonly maxFileBytes: number = DEFAULT_MAX_FILE_BYTES
  ) {}

  async list(clientPath: string): Promise<WorkspaceFileEntry[]> {
    const { rel, abs } = await this.resolve(clientPath);
    const dirents = await fs.readdir(abs, { withFileTypes: true }).catch((err) => {
      throw mapFsError(err);
    });

    const entries: WorkspaceFileEntry[] = [];
    for (const dirent of dirents) {
      // Backslashes cannot be addressed through the protocol (normalizeClientPath
      // rejects them), so such entries are left out rather than shown unopenable.
      if (dirent.name.includes("\\")) continue;
      const childRel = rel === "" ? dirent.name : `${rel}/${dirent.name}`;
      let stat;
      try {
        // Rejects symlinks that point outside the root; they are not listed.
        await resolveInRoot(this.root, childRel);
        stat = await fs.stat(path.join(this.root.realPath, childRel));
      } catch {
        continue;
      }
      entries.push({
        path: childRel,
        name: dirent.name,
        isDirectory: stat.isDirectory(),
        size: stat.isDirectory() ? undefined : stat.size,
        children: stat.isDirectory() ? [] : undefined,
      });
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  async read(clientPath: string): Promise<string> {
    const { rel, abs } = await this.resolve(clientPath);
    const stat = await statOrThrow(abs);
    if (stat.isDirectory()) throw new ServerFsError(400, `${rel} is a directory`);
    this.assertWithinLimit(stat.size);

    const contents = await fs.readFile(abs, "utf8").catch((err) => {
      throw mapFsError(err);
    });
    this.known.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size });
    return contents;
  }

  async write(clientPath: string, contents: string): Promise<void> {
    const { rel, abs } = await this.resolve(clientPath);
    if (rel === "") throw new ServerFsError(400, "cannot write to the workspace root");
    this.assertWithinLimit(Buffer.byteLength(contents, "utf8"));
    await this.assertUnchangedSinceRead(rel, abs);

    await fs.writeFile(abs, contents, "utf8").catch((err) => {
      throw mapFsError(err);
    });
    await this.remember(rel, abs);
  }

  async create(clientPath: string, contents: string): Promise<void> {
    const { rel, abs } = await this.resolve(clientPath);
    if (rel === "") throw new ServerFsError(400, "cannot create the workspace root");
    this.assertWithinLimit(Buffer.byteLength(contents, "utf8"));

    await fs.mkdir(path.dirname(abs), { recursive: true }).catch((err) => {
      throw mapFsError(err);
    });
    await fs.writeFile(abs, contents, { encoding: "utf8", flag: "wx" }).catch((err) => {
      throw mapFsError(err);
    });
    await this.remember(rel, abs);
  }

  async mkdir(clientPath: string): Promise<void> {
    const { rel, abs } = await this.resolve(clientPath);
    if (rel === "") throw new ServerFsError(400, "the workspace root already exists");
    await fs.mkdir(abs, { recursive: true }).catch((err) => {
      throw mapFsError(err);
    });
  }

  async rename(clientPath: string, newClientPath: string): Promise<void> {
    const from = await this.resolve(clientPath);
    const to = await this.resolve(newClientPath);
    if (from.rel === "" || to.rel === "") throw new ServerFsError(400, "cannot rename the workspace root");
    if (await pathExists(to.abs)) throw new ServerFsError(409, `${to.rel} already exists`);

    await fs.mkdir(path.dirname(to.abs), { recursive: true }).catch((err) => {
      throw mapFsError(err);
    });
    await fs.rename(from.abs, to.abs).catch((err) => {
      throw mapFsError(err);
    });
    this.forget(from.rel);
  }

  async delete(clientPath: string): Promise<void> {
    const { rel, abs } = await this.resolve(clientPath);
    if (rel === "") throw new ServerFsError(400, "cannot delete the workspace root");
    await statOrThrow(abs);
    // fs.rm on a symlink removes the link itself, never its target.
    await fs.rm(abs, { recursive: true, force: false }).catch((err) => {
      throw mapFsError(err);
    });
    this.forget(rel);
  }

  private async resolve(clientPath: string): Promise<{ rel: string; abs: string }> {
    // The renderer only ever sends root-relative paths. normalizeClientPath
    // would quietly re-root "/etc/x" to "etc/x"; refuse it outright instead.
    if (typeof clientPath === "string" && (clientPath.startsWith("/") || /^[A-Za-z]:/.test(clientPath))) {
      throw new ServerFsError(400, "absolute paths are not accepted; use a workspace-relative path");
    }
    const resolved = await resolveInRoot(this.root, clientPath);
    return { rel: resolved.rel, abs: resolved.abs };
  }

  private assertWithinLimit(bytes: number): void {
    if (bytes > this.maxFileBytes) {
      throw new ServerFsError(413, `file exceeds the ${this.maxFileBytes}-byte limit`);
    }
  }

  private async assertUnchangedSinceRead(rel: string, abs: string): Promise<void> {
    const seen = this.known.get(rel);
    if (!seen) return; // never read in this window: nothing to compare against
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ServerFsError(409, `${rel} was deleted on disk after it was opened`);
      }
      throw mapFsError(err);
    }
    if (stat.mtimeMs !== seen.mtimeMs || stat.size !== seen.size) {
      throw new ServerFsError(409, `${rel} changed on disk after it was opened. Nothing was written; your edits are still in the tab`);
    }
  }

  private async remember(rel: string, abs: string): Promise<void> {
    const stat = await fs.stat(abs).catch(() => null);
    if (stat) this.known.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size });
  }

  private forget(rel: string): void {
    for (const key of this.known.keys()) {
      if (key === rel || key.startsWith(`${rel}/`)) this.known.delete(key);
    }
  }
}

async function statOrThrow(abs: string) {
  try {
    return await fs.stat(abs);
  } catch (err) {
    throw mapFsError(err);
  }
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await fs.lstat(abs);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw mapFsError(err);
  }
}

/** Maps Node errno codes onto the HTTP-style statuses the containment layer uses. */
export function mapFsError(err: unknown): Error {
  if (err instanceof ServerFsError) return err;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case "ENOENT":
      return new ServerFsError(404, "not found");
    case "EEXIST":
      return new ServerFsError(409, "already exists");
    case "ENOTEMPTY":
      return new ServerFsError(409, "directory is not empty");
    case "EISDIR":
    case "ENOTDIR":
      return new ServerFsError(400, "wrong entry type for this operation");
    case "EACCES":
    case "EPERM":
      return new ServerFsError(403, "permission denied by the operating system");
    default:
      return err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * The root-relative, forward-slash path of `file` when it lies inside `root`,
 * otherwise null. Both arguments must be canonical (realpath) paths.
 */
export function relativeWithin(root: string, file: string): string | null {
  const rel = path.relative(root, file);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}
