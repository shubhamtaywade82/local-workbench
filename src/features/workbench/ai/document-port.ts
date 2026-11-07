// Connects the assistant controller to the open documents, the editor and the
// active workspace. It is the only place where the assistant touches the
// workbench's stores.

import { documentRegistry } from "@/documents/core/registry";
import { useWorkbench } from "@/features/workbench/store";
import { replaceInEditor, selectionIn } from "@/features/workbench/editor/editor-bridge";
import { getActiveWorkspaceFs, openFileFromWorkspace } from "@/platform/filesystem/use-workspace-controller";
import type { WorkspaceFileSystem } from "@/platform/filesystem/workspace-fs";
import type { DocumentSnapshot } from "@/lib/ai/tasks/contract";

import type { DocumentPort } from "./assistant-controller";

function requireWorkspace(): WorkspaceFileSystem {
  const fs = getActiveWorkspaceFs();
  if (!fs) throw new Error("Open a folder, or the sample workspace, before creating files.");
  return fs;
}

async function ensureDirectory(fs: WorkspaceFileSystem, path: string): Promise<void> {
  const parts = path.split("/").slice(0, -1);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await fs.createDirectory(current);
    } catch {
      // The folder already exists.
    }
  }
}

async function exists(fs: WorkspaceFileSystem, path: string): Promise<boolean> {
  try {
    await fs.readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function refreshTree(fs: WorkspaceFileSystem): Promise<void> {
  useWorkbench.getState().setTree(await fs.listDirectory(""));
}

export const documentPort: DocumentPort = {
  activePath: () => useWorkbench.getState().activeTab,

  textOf: (path) => useWorkbench.getState().sessions[path]?.draftText ?? null,

  snapshot: (path): DocumentSnapshot | null => {
    const state = useWorkbench.getState();
    const session = state.sessions[path];
    if (!session) return null;
    const adapter = documentRegistry.resolveForContent(path, session.draftText);
    const selection = selectionIn(path);
    const diagnostics = (state.diagnostics[path] ?? []).slice(0, 100).map((d) => ({
      severity: d.severity,
      message: d.message.slice(0, 1000),
      ...(d.range ? { line: d.range.startLine } : {}),
      ...(d.code ? { code: d.code.slice(0, 120) } : {}),
    }));
    return {
      path,
      languageId: adapter.languageId,
      adapterId: adapter.id,
      text: session.draftText,
      ...(selection ? { selection } : {}),
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
  },

  replaceText: (path, text) => {
    if (!replaceInEditor(path, text)) useWorkbench.getState().updateDraft(path, text);
  },

  createDocument: async (path, text) => {
    const fs = requireWorkspace();
    await ensureDirectory(fs, path);
    await fs.createFile(path, text);
    await openFileFromWorkspace(fs, path);
    await refreshTree(fs);
  },

  uniquePath: async (suggestion) => {
    const fs = getActiveWorkspaceFs();
    if (!fs) return suggestion;
    const dot = suggestion.lastIndexOf(".");
    const stem = dot > suggestion.lastIndexOf("/") ? suggestion.slice(0, dot) : suggestion;
    const ext = dot > suggestion.lastIndexOf("/") ? suggestion.slice(dot) : "";
    let candidate = suggestion;
    for (let n = 2; (await exists(fs, candidate)) && n < 100; n += 1) {
      candidate = `${stem}-${n}${ext}`;
    }
    return candidate;
  },
};
