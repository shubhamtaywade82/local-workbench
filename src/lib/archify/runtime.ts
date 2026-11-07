// Server-only: locates the vendored Archify runtime and the Node binary that
// runs it. Archify's CLI is zero-dependency ESM, so Node 18+ is enough.

import fs from "node:fs";
import path from "node:path";

export const ARCHIFY_RUNTIME_DIR = path.join("vendor", "archify");

export interface ArchifyRuntime {
  /** Absolute path of the vendored Archify tree. */
  readonly root: string;
  /** Absolute path of bin/archify.mjs. */
  readonly cli: string;
  /** Executable used to run the CLI. */
  readonly nodeBinary: string;
}

export type ArchifyRuntimeResolution =
  | { readonly ok: true; readonly runtime: ArchifyRuntime }
  | { readonly ok: false; readonly message: string };

/**
 * Runs under `bun run dev`, where process.execPath is Bun. Archify must run
 * under Node, so Bun falls back to the `node` on PATH.
 */
export function nodeBinaryFor(execPath: string): string {
  return /(^|[\\/])node(\.exe)?$/i.test(execPath) ? execPath : "node";
}

export function resolveArchifyRuntime(
  options: { cwd?: string; execPath?: string } = {}
): ArchifyRuntimeResolution {
  const root = path.resolve(options.cwd ?? process.cwd(), ARCHIFY_RUNTIME_DIR);
  const cli = path.join(root, "bin", "archify.mjs");
  if (!fs.existsSync(cli)) {
    return {
      ok: false,
      message:
        `The Archify runtime is missing from ${ARCHIFY_RUNTIME_DIR}. ` +
        "Restore it with: node scripts/sync-archify.mjs --from <archify checkout>.",
    };
  }
  return {
    ok: true,
    runtime: {
      root,
      cli,
      nodeBinary: nodeBinaryFor(options.execPath ?? process.execPath),
    },
  };
}
