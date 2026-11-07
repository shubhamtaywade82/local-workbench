// Centralised workbench state. Owns open tabs, dirty sessions, diagnostics, AI
// status, and which panes are visible. Persisted to IndexedDB by the persistence
// layer (recent workspaces, recovery drafts).

"use client";

import { create } from "zustand";
import type { Diagnostic } from "@/documents/core/types";
import { createSession, type DocumentSession } from "@/documents/core/session";
import type { Workspace, WorkspaceFileEntry } from "@/documents/core/types";

export interface OpenTab {
  path: string;
  name: string;
  languageId: string;
  /** Adapter id used to render the preview. */
  adapterId: string;
}

interface WorkbenchState {
  // --- Workspace -----------------------------------------------------------
  workspace: Workspace | null;
  tree: WorkspaceFileEntry[];
  treeLoading: boolean;
  treeError: string | null;

  // --- Tabs & sessions ----------------------------------------------------
  openTabs: OpenTab[];
  activeTab: string | null;
  sessions: Record<string, DocumentSession>;

  // --- Preview ------------------------------------------------------------
  previewVisible: boolean;
  previewMode: "preview" | "source";

  // --- Diagnostics --------------------------------------------------------
  diagnostics: Record<string, Diagnostic[]>;
  /** Latest Archify verdict per document. Kept apart: it is asynchronous and the parser's list is replaced on every edit. */
  archifyDiagnostics: Record<string, Diagnostic[]>;
  diagnosticsVisible: boolean;

  // --- Panels -------------------------------------------------------------
  aiVisible: boolean;
  /** Which pane a phone shows: the editor or the preview. */
  mobileView: "editor" | "preview";

  // --- UI -----------------------------------------------------------------
  explorerVisible: boolean;
  commandPaletteOpen: boolean;
  theme: "dark" | "light";

  // --- Actions ------------------------------------------------------------
  setWorkspace: (workspace: Workspace | null) => void;
  setTree: (tree: WorkspaceFileEntry[]) => void;
  setTreeLoading: (loading: boolean, error?: string | null) => void;

  openTab: (tab: OpenTab, initialContent: string) => void;
  closeTab: (path: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (path: string | null) => void;
  updateDraft: (path: string, text: string) => void;
  markSaved: (path: string, savedText: string) => void;
  revertDraft: (path: string) => void;
  reloadFromDisk: (path: string, content: string) => void;

  setPreviewVisible: (visible: boolean) => void;
  setPreviewMode: (mode: "preview" | "source") => void;

  setDiagnostics: (path: string, diagnostics: Diagnostic[]) => void;
  clearDiagnostics: (path: string) => void;
  setArchifyDiagnostics: (path: string, diagnostics: Diagnostic[]) => void;
  setDiagnosticsVisible: (visible: boolean) => void;

  setAiVisible: (visible: boolean) => void;
  setMobileView: (view: "editor" | "preview") => void;

  setExplorerVisible: (visible: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setTheme: (theme: "dark" | "light") => void;
}

export const useWorkbench = create<WorkbenchState>((set) => ({
  workspace: null,
  tree: [],
  treeLoading: false,
  treeError: null,

  openTabs: [],
  activeTab: null,
  sessions: {},

  previewVisible: true,
  previewMode: "preview",

  diagnostics: {},
  archifyDiagnostics: {},
  diagnosticsVisible: true,

  aiVisible: true,
  mobileView: "editor",

  explorerVisible: true,
  commandPaletteOpen: false,
  theme: "dark",

  setWorkspace: (workspace) => set({ workspace }),
  setTree: (tree) => set({ tree }),
  setTreeLoading: (loading, error = null) =>
    set({ treeLoading: loading, treeError: error }),

  openTab: (tab, initialContent) =>
    set((state) => {
      const exists = state.openTabs.some((t) => t.path === tab.path);
      const openTabs = exists
        ? state.openTabs
        : [...state.openTabs, tab];
      const sessions = exists
        ? state.sessions
        : {
            ...state.sessions,
            [tab.path]: createSession(tab.path, initialContent),
          };
      return { openTabs, activeTab: tab.path, sessions };
    }),

  closeTab: (path) =>
    set((state) => {
      const openTabs = state.openTabs.filter((t) => t.path !== path);
      const sessions = { ...state.sessions };
      delete sessions[path];
      const diagnostics = { ...state.diagnostics };
      delete diagnostics[path];
      const archifyDiagnostics = { ...state.archifyDiagnostics };
      delete archifyDiagnostics[path];
      const activeTab =
        state.activeTab === path
          ? openTabs.length > 0
            ? openTabs[openTabs.length - 1].path
            : null
          : state.activeTab;
      return { openTabs, sessions, diagnostics, archifyDiagnostics, activeTab };
    }),

  closeAllTabs: () =>
    set({
      openTabs: [],
      sessions: {},
      diagnostics: {},
      archifyDiagnostics: {},
      activeTab: null,
    }),

  setActiveTab: (path) => set({ activeTab: path }),

  updateDraft: (path, text) =>
    set((state) => {
      const session = state.sessions[path];
      if (!session) return state;
      const next: DocumentSession = {
        ...session,
        draftText: text,
        revision: session.revision + 1,
        isDirty: text !== session.savedText,
      };
      return { sessions: { ...state.sessions, [path]: next } };
    }),

  markSaved: (path, savedText) =>
    set((state) => {
      const session = state.sessions[path];
      if (!session) return state;
      const next: DocumentSession = {
        ...session,
        savedText,
        draftText: session.draftText,
        savedRevision: session.revision,
        isDirty: session.draftText !== savedText,
      };
      return { sessions: { ...state.sessions, [path]: next } };
    }),

  revertDraft: (path) =>
    set((state) => {
      const session = state.sessions[path];
      if (!session) return state;
      const next: DocumentSession = {
        ...session,
        draftText: session.savedText,
        revision: session.revision + 1,
        isDirty: false,
      };
      return { sessions: { ...state.sessions, [path]: next } };
    }),

  reloadFromDisk: (path, content) =>
    set((state) => {
      const session = state.sessions[path];
      if (!session) return state;
      const next: DocumentSession = {
        ...session,
        savedText: content,
        draftText: session.isDirty ? session.draftText : content,
        revision: session.revision + 1,
        savedRevision: session.revision + 1,
        isDirty: session.isDirty,
      };
      return { sessions: { ...state.sessions, [path]: next } };
    }),

  setPreviewVisible: (previewVisible) => set({ previewVisible }),
  setPreviewMode: (previewMode) => set({ previewMode }),

  setDiagnostics: (path, diagnostics) =>
    set((state) => ({
      diagnostics: { ...state.diagnostics, [path]: diagnostics },
    })),
  clearDiagnostics: (path) =>
    set((state) => {
      const diagnostics = { ...state.diagnostics };
      delete diagnostics[path];
      return { diagnostics };
    }),
  setArchifyDiagnostics: (path, diagnostics) =>
    set((state) => ({
      archifyDiagnostics: { ...state.archifyDiagnostics, [path]: diagnostics },
    })),
  setDiagnosticsVisible: (diagnosticsVisible) => set({ diagnosticsVisible }),

  setAiVisible: (aiVisible) => set({ aiVisible }),
  setMobileView: (mobileView) => set({ mobileView }),

  setExplorerVisible: (explorerVisible) => set({ explorerVisible }),
  setCommandPaletteOpen: (commandPaletteOpen) =>
    set({ commandPaletteOpen }),
  setTheme: (theme) => set({ theme }),
}));

// --- Selectors -------------------------------------------------------------

export function selectActiveSession(
  state: WorkbenchState
): DocumentSession | null {
  if (!state.activeTab) return null;
  return state.sessions[state.activeTab] ?? null;
}

export function selectActiveTab(state: WorkbenchState): OpenTab | null {
  if (!state.activeTab) return null;
  return state.openTabs.find((t) => t.path === state.activeTab) ?? null;
}

export function selectAllDiagnostics(state: WorkbenchState): Diagnostic[] {
  return [...Object.values(state.diagnostics).flat(), ...Object.values(state.archifyDiagnostics).flat()];
}

export function selectDirtyCount(state: WorkbenchState): number {
  return Object.values(state.sessions).filter((s) => s.isDirty).length;
}
