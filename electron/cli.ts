// Command-line contract for `local-workbench`. Pure Node: loaded by the
// launcher (plain Node) and by the Electron main process.

import { promises as fs } from "node:fs";
import path from "node:path";
import { translateArgumentPath, type WslInfo } from "./platform";

export {
  detectWsl,
  sandboxAdvice,
  translateArgumentPath,
  windowsCommandShim,
  type HostEnvironment,
  type SandboxFacts,
  type WslInfo,
} from "./platform";

/** Injected at build time by scripts/build-electron.mjs. */
declare const __APP_VERSION__: string | undefined;

export const VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";

export const USAGE = `Usage: local-workbench [options] [path ...]

Open a folder as a workspace, or a file inside its folder.

  local-workbench                 Focus the app, or open a folder picker
  local-workbench .               Open the current directory
  local-workbench ~/projects/app  Open the given directory
  local-workbench notes/plan.md   Open a file; its folder becomes the workspace

Options:
  --new-window   Always open a new window, even if the folder is already open
  -h, --help     Show this help and exit
  -v, --version  Print the version and exit
`;

export type CliRequest =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "open"; readonly targets: readonly string[]; readonly newWindow: boolean }
  | { readonly kind: "error"; readonly message: string };

/**
 * Parses user arguments. Relative paths resolve against `cwd`, which is the
 * invoking shell's directory, so a second invocation from another directory
 * is interpreted correctly. Inside WSL, Windows paths (C:\..., \\wsl.localhost\...)
 * are translated to Linux paths first.
 */
export function parseCliArgs(argv: readonly string[], cwd: string, wsl: WslInfo | null = null): CliRequest {
  const targets: string[] = [];
  let newWindow = false;
  let optionsEnded = false;

  for (const arg of argv) {
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && arg.startsWith("-") && arg !== "-") {
      if (arg === "-h" || arg === "--help") return { kind: "help" };
      if (arg === "-v" || arg === "--version") return { kind: "version" };
      if (arg === "--new-window") {
        newWindow = true;
        continue;
      }
      return { kind: "error", message: `unknown option: ${arg}` };
    }
    if (arg.includes("\u0000")) return { kind: "error", message: "path contains a NUL byte" };
    if (arg === "") return { kind: "error", message: "empty path argument" };
    const translated = translateArgumentPath(arg, wsl);
    if (!translated.ok) return { kind: "error", message: translated.message };
    targets.push(path.resolve(cwd, translated.path));
  }

  return { kind: "open", targets, newWindow };
}

export interface ResolvedTarget {
  /** Canonical directory the window's workspace is rooted at. */
  readonly rootPath: string;
  /** Canonical file name inside `rootPath` to open, or null for a directory target. */
  readonly openFile: string | null;
}

/**
 * Resolves an absolute target to a workspace root. Directories are used as
 * they are; files use their containing directory. Symlinks are resolved first,
 * so a link to a file in another project opens that project.
 */
export async function resolveTarget(absolutePath: string): Promise<ResolvedTarget> {
  let real: string;
  try {
    real = await fs.realpath(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`no such file or directory: ${absolutePath}`);
    }
    throw err;
  }

  const stat = await fs.stat(real);
  if (stat.isDirectory()) return { rootPath: real, openFile: null };
  if (stat.isFile()) return { rootPath: path.dirname(real), openFile: path.basename(real) };
  throw new Error(`not a regular file or directory: ${absolutePath}`);
}
