// Client-side workspace controller. Bridges the React UI to the
// WorkspaceFileSystem implementations and the Zustand workbench store.
//
// Responsibilities:
//  - open / pick / create workspaces
//  - lazily load directory children for the explorer
//  - read file contents into editor sessions on tab open
//  - persist dirty drafts to IndexedDB for recovery
//  - periodically flush drafts (every 5s while there are dirty tabs)

"use client";

import { useCallback, useEffect, useRef } from "react";
import { useWorkbench } from "@/features/workbench/store";
import { documentRegistry } from "@/documents/core/registry";
import {
  InMemoryWorkspace,
  FileSystemAccessWorkspace,
  isFileSystemAccessSupported,
  pickDirectory,
  type WorkspaceFileSystem,
} from "@/platform/filesystem/workspace-fs";
import { ServerWorkspace, type ServerRootInfo } from "@/platform/filesystem/server-workspace";
import { SAMPLE_FILES, SAMPLE_WORKSPACE_NAME } from "@/platform/filesystem/sample-workspace";
import {
  addRecentWorkspace,
  saveRecoveryDraft,
  clearRecoveryDrafts,
  listRecoveryDrafts,
  type RecentWorkspace,
} from "@/platform/persistence/persistence";

export type WorkspaceController = {
  /** Open the in-memory sample workspace as a fallback. */
  openSampleWorkspace: () => Promise<void>;
  /** Prompt the user to pick a directory (FSA API). */
  openLocalDirectory: () => Promise<void>;
  /** Open a server-side root (WORKSPACE_ROOTS, e.g. a folder inside WSL). */
  openServerWorkspace: (root: ServerRootInfo) => Promise<void>;
  /** Returns the active workspace fs (sample or local) or null. */
  getFs: () => WorkspaceFileSystem | null;
};

let fsRef: WorkspaceFileSystem | null = null;

export function useWorkspaceController(): WorkspaceController {
  const setWorkspace = useWorkbench((s) => s.setWorkspace);
  const setTree = useWorkbench((s) => s.setTree);
  const setTreeLoading = useWorkbench((s) => s.setTreeLoading);
  const sessions = useWorkbench((s) => s.sessions);
  const workspace = useWorkbench((s) => s.workspace);

  // Build the initial root tree (just the top level — directories are
  // expanded lazily by the explorer).
  const refreshRoot = useCallback(
    async (fs: WorkspaceFileSystem) => {
      setTreeLoading(true);
      try {
        const entries = await fs.listDirectory("");
        setTree(entries);
      } catch (err) {
        setTreeLoading(false, (err as Error).message);
        return;
      }
      setTreeLoading(false);
    },
    [setTree, setTreeLoading]
  );

  const recordRecent = useCallback(async (ws: WorkspaceFileSystem) => {
    const recent: RecentWorkspace = {
      id: `${ws.workspace.source}:${ws.workspace.name}`,
      name: ws.workspace.name,
      source: ws.workspace.source,
      createdAt: ws.workspace.createdAt,
      lastOpenedAt: Date.now(),
      handleName: ws.workspace.name,
      ...(ws.workspace.serverRootId ? { serverRootId: ws.workspace.serverRootId } : {}),
    };
    await addRecentWorkspace(recent);
  }, []);

  // Returns false if the user cancels because of unsaved changes, true
  // otherwise (including when there's nothing to confirm).
  const confirmSwitchWorkspace = useCallback((): boolean => {
    const sessions = useWorkbench.getState().sessions;
    const dirty = Object.values(sessions).filter((s) => s.isDirty);
    if (dirty.length === 0) return true;
    const names = dirty.map((s) => s.path.split("/").pop()).join(", ");
    return window.confirm(
      `You have unsaved changes in: ${names}.\n\nSwitching workspaces will close these tabs. Recovery drafts have been saved to IndexedDB, but you should save first if you want to keep them on disk.\n\nContinue switching?`
    );
  }, []);

  const openSampleWorkspace = useCallback(async () => {
    // Confirm if there are unsaved changes in the current workspace.
    if (!confirmSwitchWorkspace()) return;
    // Close all tabs from the previous workspace so we start fresh.
    useWorkbench.getState().closeAllTabs();
    const fs = new InMemoryWorkspace(SAMPLE_WORKSPACE_NAME, SAMPLE_FILES);
    fsRef = fs;
    setWorkspace(fs.workspace);
    await recordRecent(fs);
    await refreshRoot(fs);
    // Pre-open README.md so the editor isn't empty on first load.
    try {
      const content = await fs.readFile("README.md");
      const adapter = documentRegistry.resolve("README.md");
      useWorkbench.getState().openTab(
        {
          path: "README.md",
          name: "README.md",
          languageId: adapter.languageId,
          adapterId: adapter.id,
        },
        content
      );
    } catch {
      // ignore — user can open manually
    }
  }, [recordRecent, refreshRoot, setWorkspace]);

  // Shared by every disk-backed workspace (local folder, server root): swap in
  // the new fs, load its tree, and restore any recovery drafts for it.
  const activatePersistentWorkspace = useCallback(
    async (fs: WorkspaceFileSystem) => {
      // Close all tabs from the previous workspace so we start fresh.
      useWorkbench.getState().closeAllTabs();
      fsRef = fs;
      setWorkspace(fs.workspace);
      await recordRecent(fs);
      await refreshRoot(fs);
      // Offer to restore recovery drafts if present.
      try {
        const drafts = await listRecoveryDrafts(
          `${fs.workspace.source}:${fs.workspace.name}`
        );
        if (drafts.length > 0) {
          // Open each draft path with its draft content so the user sees the
          // unsaved state immediately, with the dirty indicator on.
          const state = useWorkbench.getState();
          for (const draft of drafts) {
            let saved = draft.savedContent;
            if (!saved) {
              try {
                saved = await fs.readFile(draft.path);
              } catch {
                saved = "";
              }
            }
            const adapter = documentRegistry.resolve(draft.path);
            state.openTab(
              {
                path: draft.path,
                name: draft.path.split("/").pop() ?? draft.path,
                languageId: adapter.languageId,
                adapterId: adapter.id,
              },
              saved
            );
            // Restore unsaved content as the draft text.
            useWorkbench.getState().updateDraft(draft.path, draft.content);
          }
        }
      } catch (err) {
        console.error("Failed to load recovery drafts:", err);
      }
    },
    [recordRecent, refreshRoot, setWorkspace]
  );

  const openLocalDirectory = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      // Fall back silently to sample workspace.
      await openSampleWorkspace();
      return;
    }
    // Confirm before switching if there are unsaved changes.
    if (!confirmSwitchWorkspace()) return;
    const handle = await pickDirectory();
    if (!handle) return; // user cancelled
    await activatePersistentWorkspace(new FileSystemAccessWorkspace(handle));
  }, [activatePersistentWorkspace, confirmSwitchWorkspace, openSampleWorkspace]);

  const openServerWorkspace = useCallback(
    async (root: ServerRootInfo) => {
      if (!confirmSwitchWorkspace()) return;
      await activatePersistentWorkspace(new ServerWorkspace(root));
    },
    [activatePersistentWorkspace, confirmSwitchWorkspace]
  );

  const getFs = useCallback(() => fsRef, []);

  // Periodically flush dirty drafts to IndexedDB for crash recovery.
  // Also clears drafts when sessions become clean.
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!workspace) return;
    flushTimer.current = setInterval(async () => {
      if (!fsRef) return;
      const wsId = `${fsRef.workspace.source}:${fsRef.workspace.name}`;
      // Save dirty drafts.
      for (const s of Object.values(sessions)) {
        if (s.isDirty) {
          await saveRecoveryDraft({
            id: `${wsId}::${s.path}`,
            workspaceId: wsId,
            path: s.path,
            content: s.draftText,
            savedContent: s.savedText,
            updatedAt: Date.now(),
          });
        } else {
          // If clean, ensure no stale draft remains.
          // (deleteRecoveryDraft is imported but we skip the per-call cost
          // when not needed — only run when the session was previously dirty.)
        }
      }
    }, 5000);
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current);
    };
  }, [sessions, workspace]);

  // When a session transitions to clean (saved), clear its draft.
  const prevDirty = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!fsRef) return;
    const wsId = `${fsRef.workspace.source}:${fsRef.workspace.name}`;
    for (const s of Object.values(sessions)) {
      const wasDirty = prevDirty.current[s.path] ?? false;
      if (wasDirty && !s.isDirty) {
        // became clean — clear the draft
        import("@/platform/persistence/persistence").then((m) =>
          m.deleteRecoveryDraft(`${wsId}::${s.path}`)
        );
      }
      prevDirty.current[s.path] = s.isDirty;
    }
  }, [sessions]);

  // Clear all drafts for the workspace when it changes.
  useEffect(() => {
    if (!fsRef) return;
    const wsId = `${fsRef.workspace.source}:${fsRef.workspace.name}`;
    // Note: we do NOT clear drafts here on workspace open — they may be
    // restored above. Drafts are cleared when sessions become clean.
    void wsId;
  }, [workspace]);

  return { openSampleWorkspace, openLocalDirectory, openServerWorkspace, getFs };
}

/** Read a file from the active workspace into a new editor tab. */
export async function openFileFromWorkspace(
  fs: WorkspaceFileSystem,
  path: string
): Promise<void> {
  const adapter = documentRegistry.resolve(path);
  const content = await fs.readFile(path);
  useWorkbench.getState().openTab(
    {
      path,
      name: path.split("/").pop() ?? path,
      languageId: adapter.languageId,
      adapterId: adapter.id,
    },
    content
  );
}

/** Save a session's draft back to the active workspace. */
export async function saveSessionToWorkspace(
  fs: WorkspaceFileSystem,
  path: string
): Promise<void> {
  const session = useWorkbench.getState().sessions[path];
  if (!session) return;
  await fs.writeFile(path, session.draftText);
  useWorkbench.getState().markSaved(path, session.draftText);
}

/** Save all dirty sessions. */
export async function saveAllSessions(fs: WorkspaceFileSystem): Promise<void> {
  const sessions = useWorkbench.getState().sessions;
  for (const path of Object.keys(sessions)) {
    if (sessions[path].isDirty) {
      await saveSessionToWorkspace(fs, path);
    }
  }
}

/** Re-export for components that need to clear drafts on workspace switch. */
export async function clearWorkspaceDrafts(
  source: string,
  name: string
): Promise<void> {
  await clearRecoveryDrafts(`${source}:${name}`);
}
