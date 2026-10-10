// Server-backed workspace: files live on the machine running the Next.js
// server (e.g. inside WSL) and are accessed through /api/fs. Only roots the
// server lists in WORKSPACE_ROOTS are reachable; see src/lib/server-fs/.

"use client";

import type { Workspace, WorkspaceFileEntry } from "@/documents/core/types";
import type { WorkspaceFileSystem } from "./workspace-fs";

export interface ServerRootInfo {
  id: string;
  name: string;
}

/** Must match SERVER_FS_HEADER in src/lib/server-fs/guard.ts. */
const SERVER_FS_HEADERS = { "X-Workbench-FS": "1" } as const;

export class ServerFsRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ServerFsRequestError";
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // fall through
  }
  return `${res.status} ${res.statusText}`;
}

/**
 * Roots the server exposes, or `null` when the server workspace is disabled
 * (404) or unreachable. Never throws.
 */
export async function listServerRoots(): Promise<ServerRootInfo[] | null> {
  try {
    const res = await fetch("/api/fs/roots", { headers: SERVER_FS_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { roots?: ServerRootInfo[] };
    return Array.isArray(body.roots) ? body.roots : null;
  } catch {
    return null;
  }
}

export class ServerWorkspace implements WorkspaceFileSystem {
  readonly workspace: Workspace;
  readonly canPersist: boolean = true;

  constructor(root: ServerRootInfo) {
    this.workspace = {
      name: root.name,
      rootPath: "/",
      source: "server",
      createdAt: Date.now(),
      serverRootId: root.id,
    };
  }

  private async call<T>(op: string, payload: Record<string, unknown>): Promise<T> {
    const res = await fetch("/api/fs", {
      method: "POST",
      headers: { ...SERVER_FS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ op, root: this.workspace.serverRootId, ...payload }),
      cache: "no-store",
    });
    if (!res.ok) throw new ServerFsRequestError(res.status, await readError(res));
    return (await res.json()) as T;
  }

  async listDirectory(path: string): Promise<WorkspaceFileEntry[]> {
    return (await this.call<{ entries: WorkspaceFileEntry[] }>("list", { path })).entries;
  }

  async readFile(path: string): Promise<string> {
    return (await this.call<{ contents: string }>("read", { path })).contents;
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await this.call("write", { path, contents });
  }

  async createFile(path: string, initialContent = ""): Promise<void> {
    await this.call("create", { path, contents: initialContent });
  }

  async createDirectory(path: string): Promise<void> {
    await this.call("mkdir", { path });
  }

  async rename(path: string, newPath: string): Promise<void> {
    await this.call("rename", { path, newPath });
  }

  async delete(path: string): Promise<void> {
    await this.call("delete", { path });
  }
}
