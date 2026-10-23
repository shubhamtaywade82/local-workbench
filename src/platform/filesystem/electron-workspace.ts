// Workspace backed by the Electron main process. Paths are workspace-relative;
// the main process resolves them against the folder this window is bound to.
// Requests carry the binding token, so a handle left over from a previous
// folder fails with STALE_WORKSPACE instead of writing into the new one.

"use client";

import type { Workspace, WorkspaceFileEntry } from "@/documents/core/types";
import { DesktopFsError, type DesktopBridge, type DesktopFsRequest, type DesktopFsResult, type DesktopLaunchTarget } from "@/lib/desktop/contract";
import type { WorkspaceFileSystem } from "./workspace-fs";

export class ElectronWorkspace implements WorkspaceFileSystem {
  readonly workspace: Workspace;
  readonly canPersist: boolean = true;

  constructor(
    private readonly bridge: DesktopBridge,
    private readonly target: DesktopLaunchTarget
  ) {
    this.workspace = {
      name: target.name,
      rootPath: "/",
      source: "electron",
      createdAt: Date.now(),
      rootId: target.rootId,
    };
  }

  listDirectory(path: string): Promise<WorkspaceFileEntry[]> {
    return this.send<WorkspaceFileEntry[]>({ method: "list", token: this.target.token, path });
  }

  async readFile(path: string): Promise<string> {
    return this.send<string>({ method: "read", token: this.target.token, path });
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await this.send<null>({ method: "write", token: this.target.token, path, contents });
  }

  async createFile(path: string, initialContent = ""): Promise<void> {
    await this.send<null>({ method: "create", token: this.target.token, path, contents: initialContent });
  }

  async createDirectory(path: string): Promise<void> {
    await this.send<null>({ method: "mkdir", token: this.target.token, path });
  }

  async rename(path: string, newPath: string): Promise<void> {
    await this.send<null>({ method: "rename", token: this.target.token, path, newPath });
  }

  async delete(path: string): Promise<void> {
    await this.send<null>({ method: "delete", token: this.target.token, path });
  }

  private async send<T>(request: DesktopFsRequest): Promise<T> {
    const result: DesktopFsResult = await this.bridge.fs(request);
    if (!result.ok) throw new DesktopFsError(result.code, result.message);
    return result.value as T;
  }
}
