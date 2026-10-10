/**
 * Server workspace configuration.
 *
 * The server workspace lets the browser edit files on the machine running the
 * Next.js server (e.g. inside WSL). It is OFF unless `WORKSPACE_ROOTS` lists
 * one or more absolute directories; only files inside those directories can
 * ever be read or written.
 *
 *   WORKSPACE_ROOTS=/home/me/projects,/home/me/notes
 *   WORKSPACE_MAX_FILE_BYTES=5242880         # optional, default 5 MiB
 *   WORKSPACE_ALLOWED_HOSTS=devbox.local     # optional, extra Host names
 *
 * Server-only: imports node:fs. Never import from client components.
 */
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

export interface ServerRoot {
  /** Stable opaque id derived from the real path; what clients address roots by. */
  readonly id: string;
  /** Display name (directory basename, disambiguated when names collide). */
  readonly name: string;
  /** Canonical absolute path (symlinks resolved). Never sent to clients. */
  readonly realPath: string;
}

export interface ServerFsConfig {
  readonly roots: readonly ServerRoot[];
  readonly maxFileBytes: number;
  /** Host header values (without port) accepted by the API. */
  readonly allowedHosts: ReadonlySet<string>;
}

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

function rootId(realPath: string): string {
  return createHash("sha256").update(realPath).digest("hex").slice(0, 16);
}

/** Only the WORKSPACE_* keys are read; accepts `process.env` or any plain map. */
type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * Parses configuration from an env object. Invalid roots (relative, missing,
 * not a directory) are skipped with a warning rather than failing the server.
 */
export function parseServerFsConfig(env: EnvLike = process.env): ServerFsConfig | null {
  const raw = env.WORKSPACE_ROOTS?.trim();
  if (!raw) return null;

  const seen = new Set<string>();
  const resolved: { realPath: string; base: string }[] = [];
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!path.isAbsolute(entry)) {
      console.warn(`[server-fs] WORKSPACE_ROOTS entry is not absolute, skipped: ${entry}`);
      continue;
    }
    let realPath: string;
    try {
      realPath = realpathSync(entry);
      if (!statSync(realPath).isDirectory()) throw new Error("not a directory");
    } catch (err) {
      console.warn(`[server-fs] WORKSPACE_ROOTS entry unusable, skipped: ${entry} (${(err as Error).message})`);
      continue;
    }
    if (realPath === path.parse(realPath).root) {
      console.warn(`[server-fs] Refusing filesystem root as a workspace root: ${entry}`);
      continue;
    }
    if (seen.has(realPath)) continue;
    seen.add(realPath);
    resolved.push({ realPath, base: path.basename(realPath) });
  }
  if (resolved.length === 0) return null;

  const baseCounts = new Map<string, number>();
  for (const r of resolved) baseCounts.set(r.base, (baseCounts.get(r.base) ?? 0) + 1);
  const roots = resolved.map(({ realPath, base }) => ({
    id: rootId(realPath),
    name: (baseCounts.get(base) ?? 0) > 1 ? `${base} (${path.basename(path.dirname(realPath))})` : base,
    realPath,
  }));

  const maxRaw = Number(env.WORKSPACE_MAX_FILE_BYTES);
  const maxFileBytes = Number.isInteger(maxRaw) && maxRaw > 0 ? maxRaw : DEFAULT_MAX_FILE_BYTES;

  const extraHosts = (env.WORKSPACE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  return { roots, maxFileBytes, allowedHosts: new Set([...LOCAL_HOSTS, ...extraHosts]) };
}

let cached: { key: string; config: ServerFsConfig | null } | undefined;

/** Config for the current process env, re-parsed only when the relevant env vars change. */
export function getServerFsConfig(): ServerFsConfig | null {
  const key = [
    process.env.WORKSPACE_ROOTS,
    process.env.WORKSPACE_MAX_FILE_BYTES,
    process.env.WORKSPACE_ALLOWED_HOSTS,
  ].join("\u0000");
  if (!cached || cached.key !== key) cached = { key, config: parseServerFsConfig() };
  return cached.config;
}
