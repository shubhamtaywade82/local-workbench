/**
 * Filesystem operations for the server workspace. Every path goes through
 * `resolveInRoot`; callers never touch `node:fs` with client input directly.
 *
 * Server-only: imports node:fs.
 */
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceFileEntry } from "@/documents/core/types";
import type { ServerFsConfig, ServerRoot } from "./config";
import { ServerFsError, resolveInRoot } from "./paths";

const BINARY_SNIFF_BYTES = 8192;

/** Maps Node errno codes to HTTP-ish errors; anything else is rethrown. */
function mapErrno(err: unknown, what: string): never {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") throw new ServerFsError(404, `${what}: not found`);
  if (code === "EEXIST") throw new ServerFsError(409, `${what}: already exists`);
  if (code === "ENOTDIR") throw new ServerFsError(409, `${what}: a parent is not a directory`);
  if (code === "EISDIR") throw new ServerFsError(409, `${what}: is a directory`);
  if (code === "ENOTEMPTY") throw new ServerFsError(409, `${what}: directory not empty`);
  if (code === "EACCES" || code === "EPERM") throw new ServerFsError(403, `${what}: permission denied`);
  throw err;
}

function assertTextSize(config: ServerFsConfig, contents: string, what: string): void {
  if (Buffer.byteLength(contents, "utf8") > config.maxFileBytes) {
    throw new ServerFsError(413, `${what}: exceeds the ${config.maxFileBytes}-byte limit`);
  }
}

export async function listDirectory(root: ServerRoot, clientPath: unknown): Promise<WorkspaceFileEntry[]> {
  const { rel, abs } = await resolveInRoot(root, clientPath);
  let dirents;
  try {
    dirents = await fs.readdir(abs, { withFileTypes: true });
  } catch (err) {
    mapErrno(err, rel || "/");
  }
  const entries: WorkspaceFileEntry[] = [];
  for (const d of dirents) {
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    let isDirectory = d.isDirectory();
    if (d.isSymbolicLink()) {
      // Only surface symlinks whose target stays inside the root; others are hidden.
      try {
        await resolveInRoot(root, childRel);
        isDirectory = (await fs.stat(path.join(abs, d.name))).isDirectory();
      } catch {
        continue;
      }
    } else if (!d.isFile() && !d.isDirectory()) {
      continue; // sockets, FIFOs, devices
    }
    entries.push({ path: childRel, name: d.name, isDirectory, children: isDirectory ? [] : undefined });
  }
  entries.sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name)));
  return entries;
}

export async function readFile(root: ServerRoot, config: ServerFsConfig, clientPath: unknown): Promise<string> {
  const { rel, abs } = await resolveInRoot(root, clientPath);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch (err) {
    mapErrno(err, rel);
  }
  if (!stat.isFile()) throw new ServerFsError(409, `${rel}: not a file`);
  if (stat.size > config.maxFileBytes) {
    throw new ServerFsError(413, `${rel}: ${stat.size} bytes exceeds the ${config.maxFileBytes}-byte limit`);
  }
  const buf = await fs.readFile(abs);
  if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    throw new ServerFsError(415, `${rel}: binary files are not supported`);
  }
  return buf.toString("utf8");
}

/** Atomic replace: write a temp file next to the target, then rename over it. */
export async function writeFile(
  root: ServerRoot,
  config: ServerFsConfig,
  clientPath: unknown,
  contents: unknown
): Promise<void> {
  if (typeof contents !== "string") throw new ServerFsError(400, "contents must be a string");
  const { rel, abs } = await resolveInRoot(root, clientPath);
  if (rel === "") throw new ServerFsError(400, "cannot write the workspace root");
  assertTextSize(config, contents, rel);

  let mode: number | undefined;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new ServerFsError(409, `${rel}: not a file`);
    mode = stat.mode & 0o777;
  } catch (err) {
    if (err instanceof ServerFsError) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") mapErrno(err, rel);
  }

  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    // Like the other backends, writing a new file creates missing parents.
    // Re-check containment afterwards: mkdir may have walked new directories.
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await resolveInRoot(root, rel);
    await fs.writeFile(tmp, contents, { encoding: "utf8", flag: "wx", ...(mode !== undefined ? { mode } : {}) });
    await fs.rename(tmp, abs);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    mapErrno(err, rel);
  }
}

/** Creates a new file; fails with 409 if anything already exists at the path. */
export async function createFile(
  root: ServerRoot,
  config: ServerFsConfig,
  clientPath: unknown,
  contents: unknown = ""
): Promise<void> {
  if (typeof contents !== "string") throw new ServerFsError(400, "contents must be a string");
  const { rel, abs } = await resolveInRoot(root, clientPath);
  if (rel === "") throw new ServerFsError(400, "cannot create the workspace root");
  assertTextSize(config, contents, rel);
  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Re-check after creating parents: mkdir may have walked through new dirs.
    await resolveInRoot(root, rel);
    await fs.writeFile(abs, contents, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if (err instanceof ServerFsError) throw err;
    mapErrno(err, rel);
  }
}

export async function createDirectory(root: ServerRoot, clientPath: unknown): Promise<void> {
  const { rel, abs } = await resolveInRoot(root, clientPath);
  if (rel === "") return;
  try {
    await fs.mkdir(abs, { recursive: true });
  } catch (err) {
    mapErrno(err, rel);
  }
}

/** Renames within the same root; refuses to overwrite an existing target. */
export async function rename(root: ServerRoot, fromPath: unknown, toPath: unknown): Promise<void> {
  const from = await resolveInRoot(root, fromPath);
  const to = await resolveInRoot(root, toPath);
  if (from.rel === "" || to.rel === "") throw new ServerFsError(400, "cannot rename the workspace root");
  if (to.rel === from.rel || to.rel.startsWith(`${from.rel}/`)) {
    throw new ServerFsError(400, "cannot move a path into itself");
  }
  try {
    await fs.lstat(from.abs);
  } catch (err) {
    mapErrno(err, from.rel);
  }
  try {
    await fs.lstat(to.abs);
    throw new ServerFsError(409, `${to.rel}: already exists`);
  } catch (err) {
    if (err instanceof ServerFsError) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") mapErrno(err, to.rel);
  }
  try {
    await fs.mkdir(path.dirname(to.abs), { recursive: true });
    await fs.rename(from.abs, to.abs);
  } catch (err) {
    mapErrno(err, from.rel);
  }
}

/**
 * Deletes a file or directory (recursively, matching the File System Access
 * backend). A symlink is removed as a link — its target is never touched.
 */
export async function remove(root: ServerRoot, clientPath: unknown): Promise<void> {
  const { rel, abs } = await resolveInRoot(root, clientPath);
  if (rel === "") throw new ServerFsError(400, "cannot delete the workspace root");
  try {
    const stat = await fs.lstat(abs);
    if (stat.isSymbolicLink() || !stat.isDirectory()) await fs.unlink(abs);
    else await fs.rm(abs, { recursive: true, force: false });
  } catch (err) {
    mapErrno(err, rel);
  }
}
