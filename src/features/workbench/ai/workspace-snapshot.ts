// A bounded snapshot of a workspace for architecture review. It reads the files
// most likely to describe the structure first, skips generated and vendored
// folders, and stops at fixed budgets, so the request stays small.

import type { WorkspaceFileSystem } from "@/platform/filesystem/workspace-fs";
import type { WorkspaceExcerpt } from "@/lib/ai/tasks/contract";
import type { WorkspaceFileEntry } from "@/documents/core/types";

export interface SnapshotBudget {
  readonly maxFiles: number;
  readonly maxFileChars: number;
  readonly maxTotalChars: number;
  readonly maxDirectories: number;
}

export const DEFAULT_SNAPSHOT_BUDGET: SnapshotBudget = {
  maxFiles: 60,
  maxFileChars: 4_000,
  maxTotalChars: 120_000,
  maxDirectories: 200,
};

const IGNORED_DIRECTORIES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "vendor", "coverage",
  ".turbo", ".cache", "__pycache__", ".venv", "venv", ".idea", ".vscode", "tmp", "tmp-test",
]);

const IGNORED_FILES = /(^|\/)(package-lock\.json|bun\.lock|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/;
const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|tar|woff2?|ttf|otf|mp[34]|mov|wasm|sqlite|db)$/i;

/** Lower is read first: the orientation documents, then the manifests, then the source, then everything else. */
export function priorityOf(path: string): number {
  if (/(^|\/)(README|ARCHITECTURE|CONTRIBUTING|GLOSSARY)[^/]*\.md$/i.test(path) || /^docs\//i.test(path)) return 0;
  if (/(^|\/)(package\.json|tsconfig\.json|config\.[a-z]+|pyproject\.toml|Cargo\.toml|go\.mod)$/i.test(path)) return 1;
  if (/^(src|app|lib|pkg|internal|cmd)\//.test(path) && !/\.(test|spec)\./.test(path)) return 2;
  if (/\.(test|spec)\./.test(path) || /^tests?\//.test(path)) return 3;
  return 4;
}

function isReadable(entry: WorkspaceFileEntry): boolean {
  return !entry.isDirectory && !IGNORED_FILES.test(entry.path) && !BINARY_EXTENSIONS.test(entry.path);
}

/** Breadth-first listing that stops at the directory budget. */
async function listFiles(fs: WorkspaceFileSystem, budget: SnapshotBudget): Promise<WorkspaceFileEntry[]> {
  const files: WorkspaceFileEntry[] = [];
  const queue: string[] = [""];
  let visited = 0;
  while (queue.length > 0 && visited < budget.maxDirectories) {
    const directory = queue.shift() as string;
    visited += 1;
    let entries: WorkspaceFileEntry[];
    try {
      entries = await fs.listDirectory(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(entry.path);
      } else if (isReadable(entry)) {
        files.push(entry);
      }
    }
  }
  return files;
}

export async function snapshotWorkspace(
  fs: WorkspaceFileSystem,
  budget: SnapshotBudget = DEFAULT_SNAPSHOT_BUDGET
): Promise<WorkspaceExcerpt[]> {
  const ordered = (await listFiles(fs, budget)).sort((a, b) => priorityOf(a.path) - priorityOf(b.path) || a.path.localeCompare(b.path));
  const excerpts: WorkspaceExcerpt[] = [];
  let total = 0;
  for (const entry of ordered) {
    if (excerpts.length >= budget.maxFiles || total >= budget.maxTotalChars) break;
    let text: string;
    try {
      text = await fs.readFile(entry.path);
    } catch {
      continue;
    }
    const excerpt = text.length > budget.maxFileChars ? `${text.slice(0, budget.maxFileChars)}\n… (truncated)` : text;
    const room = budget.maxTotalChars - total;
    const clipped = excerpt.length > room ? excerpt.slice(0, Math.max(0, room)) : excerpt;
    if (clipped.length === 0) break;
    excerpts.push({ path: entry.path, excerpt: clipped });
    total += clipped.length;
  }
  return excerpts;
}
