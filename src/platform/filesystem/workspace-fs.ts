// Workspace File System adapter.
//
// Provides a clean contract for reading and writing workspace files. Two
// implementations are supplied:
//
//  - FileSystemAccessWorkspace: uses the browser's File System Access API.
//    Requires a secure context and user-granted directory permission. Chrome
//    and Edge desktop are the primary targets.
//
//  - InMemoryWorkspace: a fallback that keeps files in memory. The default
//    sample workspace is loaded into this so the editor works on any browser
//    without ever asking for permissions.
//
// Both implement the same WorkspaceFileSystem contract so the rest of the app
// does not need to know which it is talking to.

"use client";

import type {
  Workspace,
  WorkspaceFileEntry,
} from "@/documents/core/types";
import { SAMPLE_FILES, SAMPLE_WORKSPACE_NAME } from "./sample-workspace";
import { getDesktopBridge } from "@/platform/electron/bridge";

export interface WriteOptions {
  /** Write even if the file changed on disk after it was read. */
  readonly force?: boolean;
}

export interface WorkspaceFileSystem {
  readonly workspace: Workspace;
  listDirectory(path: string): Promise<WorkspaceFileEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string, options?: WriteOptions): Promise<void>;
  createFile(path: string, initialContent?: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  rename(path: string, newPath: string): Promise<void>;
  delete(path: string): Promise<void>;
  /** Whether write operations are actually persisted to disk. */
  readonly canPersist: boolean;
}

// ---------------------------------------------------------------------------
// In-memory workspace
// ---------------------------------------------------------------------------

interface MemoryNode {
  name: string;
  isDirectory: boolean;
  content?: string;
  children: Map<string, MemoryNode>;
}

function buildMemoryTree(files: { path: string; content: string }[]): MemoryNode {
  const root: MemoryNode = {
    name: "",
    isDirectory: true,
    children: new Map(),
  };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = {
          name: part,
          isDirectory: !isLast,
          children: new Map(),
          content: isLast ? file.content : undefined,
        };
        node.children.set(part, child);
      }
      node = child;
    }
  }
  return root;
}

function normPath(path: string): string {
  if (!path || path === "/") return "";
  let p = path.replace(/\\/g, "/");
  if (p.startsWith("/")) p = p.slice(1);
  if (p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

export class InMemoryWorkspace implements WorkspaceFileSystem {
  readonly workspace: Workspace;
  readonly canPersist: boolean = false;
  private root: MemoryNode;
  private byPath = new Map<string, MemoryNode>();

  constructor(
    name: string = SAMPLE_WORKSPACE_NAME,
    files: { path: string; content: string }[] = SAMPLE_FILES
  ) {
    this.workspace = {
      name,
      rootPath: "/",
      source: "in-memory",
      createdAt: Date.now(),
    };
    this.root = buildMemoryTree(files);
    this.indexNode("", this.root);
  }

  private indexNode(path: string, node: MemoryNode) {
    const fullPath = path ? `${path}/${node.name}` : "";
    if (!node.isDirectory) this.byPath.set(fullPath, node);
    for (const child of node.children.values()) {
      this.indexNode(fullPath, child);
    }
  }

  private resolveNode(path: string): MemoryNode | undefined {
    const p = normPath(path);
    if (p === "") return this.root;
    if (this.byPath.has(p)) return this.byPath.get(p);
    // walk
    const parts = p.split("/").filter(Boolean);
    let node: MemoryNode | undefined = this.root;
    for (const part of parts) {
      if (!node || !node.isDirectory) return undefined;
      node = node.children.get(part);
    }
    return node;
  }

  async listDirectory(path: string): Promise<WorkspaceFileEntry[]> {
    const node = this.resolveNode(path);
    if (!node || !node.isDirectory) {
      throw new Error(`Not a directory: ${path}`);
    }
    return Array.from(node.children.values()).map((c) => ({
      path: path ? `${path}/${c.name}` : c.name,
      name: c.name,
      isDirectory: c.isDirectory,
      size: c.content?.length,
      children: c.isDirectory ? [] : undefined,
    }));
  }

  async readFile(path: string): Promise<string> {
    const node = this.resolveNode(path);
    if (!node || node.isDirectory) {
      throw new Error(`Not a file: ${path}`);
    }
    return node.content ?? "";
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const p = normPath(path);
    const existing = this.byPath.get(p);
    if (existing) {
      existing.content = contents;
      return;
    }
    // create new file
    await this.createFile(path, contents);
  }

  async createFile(path: string, initialContent = ""): Promise<void> {
    const p = normPath(path);
    const parts = p.split("/").filter(Boolean);
    if (parts.length === 0) throw new Error("Invalid path");
    let node = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      let child = node.children.get(part);
      if (!child) {
        child = {
          name: part,
          isDirectory: true,
          children: new Map(),
        };
        node.children.set(part, child);
      }
      if (!child.isDirectory) {
        throw new Error(`Path conflicts with existing file: ${part}`);
      }
      node = child;
    }
    const fileName = parts[parts.length - 1];
    if (node.children.has(fileName)) {
      throw new Error(`File already exists: ${p}`);
    }
    const fileNode: MemoryNode = {
      name: fileName,
      isDirectory: false,
      content: initialContent,
      children: new Map(),
    };
    node.children.set(fileName, fileNode);
    this.byPath.set(p, fileNode);
  }

  async createDirectory(path: string): Promise<void> {
    const p = normPath(path);
    const parts = p.split("/").filter(Boolean);
    let node = this.root;
    for (const part of parts) {
      let child = node.children.get(part);
      if (!child) {
        child = {
          name: part,
          isDirectory: true,
          children: new Map(),
        };
        node.children.set(part, child);
      }
      if (!child.isDirectory) {
        throw new Error(`Path conflicts with existing file: ${part}`);
      }
      node = child;
    }
  }

  async rename(path: string, newPath: string): Promise<void> {
    const p = normPath(path);
    const np = normPath(newPath);
    const node = this.byPath.get(p);
    if (!node) throw new Error(`File not found: ${p}`);
    await this.createFile(np, node.content ?? "");
    await this.delete(p);
  }

  async delete(path: string): Promise<void> {
    const p = normPath(path);
    const parts = p.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1];
    let node = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const child = node.children.get(part);
      if (!child || !child.isDirectory) throw new Error(`Path not found: ${p}`);
      node = child;
    }
    node.children.delete(fileName);
    this.byPath.delete(p);
  }
}

// ---------------------------------------------------------------------------
// File System Access API workspace
// ---------------------------------------------------------------------------

// Minimal typings for the File System Access API we use. Defined inline to
// avoid pulling in `wicg-file-system-access` types and to keep this file
// framework-agnostic.
interface FSHandle {
  kind: "file" | "directory";
  name: string;
}

interface FSFileHandle extends FSHandle {
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

interface FSDirHandle extends FSHandle {
  kind: "directory";
  values(): AsyncIterableIterator<FSHandle>;
  getDirectoryHandle(
    name: string,
    opts?: { create?: boolean }
  ): Promise<FSDirHandle>;
  getFileHandle(
    name: string,
    opts?: { create?: boolean }
  ): Promise<FSFileHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  requestPermission?: (opts: {
    mode: "read" | "readwrite";
  }) => Promise<"granted" | "denied" | "prompt">;
  queryPermission?: (opts: {
    mode: "read" | "readwrite";
  }) => Promise<"granted" | "denied" | "prompt">;
}

/**
 * Whether the user can pick a local folder: the native picker of the desktop
 * shell, or the browser's File System Access API.
 */
export function canPickLocalFolder(): boolean {
  return getDesktopBridge() !== null || isFileSystemAccessSupported();
}

export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker === "function"
  );
}

export async function pickDirectory(): Promise<FSDirHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  try {
    const picker = (
      window as unknown as {
        showDirectoryPicker: (opts?: {
          mode?: "read" | "readwrite";
        }) => Promise<FSDirHandle>;
      }
    ).showDirectoryPicker;
    const handle = await picker({ mode: "readwrite" });
    return handle;
  } catch (err) {
    // User cancelled — return null so caller can fall back silently.
    if ((err as DOMException)?.name === "AbortError") return null;
    throw err;
  }
}

async function ensurePermission(
  handle: FSDirHandle,
  mode: "read" | "readwrite" = "readwrite"
): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) {
    return true; // best effort: assume permission if API missing
  }
  const cur = await handle.queryPermission({ mode });
  if (cur === "granted") return true;
  const req = await handle.requestPermission({ mode });
  return req === "granted";
}

export class FileSystemAccessWorkspace implements WorkspaceFileSystem {
  readonly workspace: Workspace;
  readonly canPersist: boolean = true;
  private rootHandle: FSDirHandle;

  constructor(rootHandle: FSDirHandle) {
    this.rootHandle = rootHandle;
    this.workspace = {
      name: rootHandle.name,
      rootPath: "/",
      source: "file-system-access",
      createdAt: Date.now(),
    };
  }

  private async getDirHandle(
    path: string,
    create = false
  ): Promise<FSDirHandle> {
    const p = normPath(path);
    if (p === "") return this.rootHandle;
    const parts = p.split("/").filter(Boolean);
    let handle = this.rootHandle;
    for (const part of parts) {
      handle = await handle.getDirectoryHandle(part, { create });
    }
    return handle;
  }

  private async getFileHandleByPath(
    path: string,
    create = false
  ): Promise<{ dir: FSDirHandle; name: string; handle: FSFileHandle | null }> {
    const p = normPath(path);
    const parts = p.split("/").filter(Boolean);
    if (parts.length === 0) throw new Error("Invalid path");
    const fileName = parts[parts.length - 1];
    const dirPath = parts.slice(0, -1).join("/");
    const dir = await this.getDirHandle(dirPath, create);
    let handle: FSFileHandle | null = null;
    try {
      handle = await dir.getFileHandle(fileName, { create });
    } catch (err) {
      if (create) throw err;
      // file doesn't exist — return null
      if ((err as DOMException)?.name === "NotFoundError") {
        return { dir, name: fileName, handle: null };
      }
      throw err;
    }
    return { dir, name: fileName, handle };
  }

  async listDirectory(path: string): Promise<WorkspaceFileEntry[]> {
    const dir = await this.getDirHandle(path);
    const out: WorkspaceFileEntry[] = [];
    for await (const child of dir.values()) {
      out.push({
        path: path ? `${path}/${child.name}` : child.name,
        name: child.name,
        isDirectory: child.kind === "directory",
        children: child.kind === "directory" ? [] : undefined,
      });
    }
    out.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  async readFile(path: string): Promise<string> {
    const { handle } = await this.getFileHandleByPath(path);
    if (!handle) throw new Error(`File not found: ${path}`);
    const file = await handle.getFile();
    return file.text();
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const granted = await ensurePermission(this.rootHandle, "readwrite");
    if (!granted) throw new Error("Write permission denied for workspace");
    const { handle } = await this.getFileHandleByPath(path, true);
    if (!handle) throw new Error(`Unable to create file: ${path}`);
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
  }

  async createFile(path: string, initialContent = ""): Promise<void> {
    const { handle } = await this.getFileHandleByPath(path, true);
    if (!handle) throw new Error(`Could not create file: ${path}`);
    const writable = await handle.createWritable();
    await writable.write(initialContent);
    await writable.close();
  }

  async createDirectory(path: string): Promise<void> {
    await this.getDirHandle(path, true);
  }

  async rename(path: string, newPath: string): Promise<void> {
    // FSA API doesn't support rename directly — copy then delete.
    const content = await this.readFile(path);
    await this.createFile(newPath, content);
    await this.delete(path);
  }

  async delete(path: string): Promise<void> {
    const p = normPath(path);
    const parts = p.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1];
    const dirPath = parts.slice(0, -1).join("/");
    const dir = await this.getDirHandle(dirPath);
    await dir.removeEntry(fileName, { recursive: true });
  }
}

