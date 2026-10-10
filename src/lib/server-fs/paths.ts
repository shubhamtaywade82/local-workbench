/**
 * The ONLY place a client-supplied path becomes a filesystem path.
 *
 * Guarantees, for every path returned:
 *  1. It was a relative, NUL-free, `..`-free POSIX path from the client.
 *  2. Its lexical location is inside the root.
 *  3. Its nearest existing ancestor (or itself, if it exists) resolves through
 *     symlinks to a location inside the root's real path — so a symlink inside
 *     the root cannot be used to reach files outside it.
 *
 * Server-only: imports node:fs.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ServerRoot } from "./config";

export class ServerFsError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 415,
    message: string
  ) {
    super(message);
    this.name = "ServerFsError";
  }
}

/** Validates and normalizes a client path to a root-relative POSIX path ("" = root). */
export function normalizeClientPath(input: unknown): string {
  if (typeof input !== "string") throw new ServerFsError(400, "path must be a string");
  if (input.includes("\u0000")) throw new ServerFsError(400, "path contains a NUL byte");
  if (input.includes("\\")) throw new ServerFsError(400, "path must use forward slashes");
  if (input.length > 4096) throw new ServerFsError(400, "path too long");
  const trimmed = input.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "";
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new ServerFsError(400, `invalid path segment in "${input}"`);
    }
  }
  return segments.join("/");
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Real path of `target`, or of its nearest existing ancestor when it doesn't exist. */
async function realpathOfNearestExisting(target: string, stopAt: string): Promise<string> {
  let current = target;
  for (;;) {
    try {
      return await fs.realpath(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = path.dirname(current);
      if (parent === current || !isInside(stopAt, parent)) return stopAt;
      current = parent;
    }
  }
}

export interface ResolvedPath {
  /** Root-relative POSIX path ("" = root). */
  readonly rel: string;
  /** Absolute filesystem path (lexical; may itself be a symlink). */
  readonly abs: string;
}

/** Resolves a client path inside `root`, enforcing the guarantees in the module doc. */
export async function resolveInRoot(root: ServerRoot, clientPath: unknown): Promise<ResolvedPath> {
  const rel = normalizeClientPath(clientPath);
  const abs = rel === "" ? root.realPath : path.join(root.realPath, ...rel.split("/"));
  if (!isInside(root.realPath, abs)) throw new ServerFsError(403, "path escapes the workspace root");

  const real = await realpathOfNearestExisting(abs, root.realPath);
  if (!isInside(root.realPath, real)) {
    throw new ServerFsError(403, "path resolves outside the workspace root (symlink)");
  }
  return { rel, abs };
}
