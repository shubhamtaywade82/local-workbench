// Centralised workbench state. Owns open tabs, dirty sessions, diagnostics, AI
// status, and which panes are visible. Persisted to IndexedDB by the persistence
// layer (recent workspaces, recovery drafts).

"use client";

import { create } from "zustand";
import type { Diagnostic } from "@/documents/core/types";
import { createSession, type DocumentSession } from "@/documents/core/session";
import type { Workspace, WorkspaceFileEntry } from "@/documents/core/types";

/** Editor area view: the Monaco source editor, or the combined live view. */
export type EditorViewMode = "code" | "live";

export interface OpenTab {
  path: string;
  name: string;
  languageId: string;
  /** Adapter id used to render the preview. */
  adapterId: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Streaming marker — true while the assistant chunk is still arriving. */
  streaming?: boolean;
  /** Optional proposed edit for review-and-apply UX. */
  proposedEdit?: {
    label: string;
    description?: string;
    newText: string;
    /** Path the edit applies to. */
    path: string;
    /** Diff representation for the UI. */
    diff?: string;
  };
  error?: string;
  createdAt: number;
  /** Content may contain ```openui-lang blocks rendered as generative UI. */
  generativeUi?: boolean;
  /** Document path the message was generated against (target for proposed edits). */
  contextPath?: string;
}

export interface AiProviderInfo {
  id: string;
  name: string;
  available: boolean;
  /** Server has AI_GENERATIVE_UI enabled. */
  generativeUi?: boolean;
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

  // --- Editor view --------------------------------------------------------
  editorViewMode: EditorViewMode;

  // --- Diagnostics --------------------------------------------------------
  diagnostics: Record<string, Diagnostic[]>;
  diagnosticsVisible: boolean;

  // --- AI -----------------------------------------------------------------
  aiVisible: boolean;
  aiMessages: AiMessage[];
  aiBusy: boolean;
  aiProvider: AiProviderInfo | null;

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

  setEditorViewMode: (mode: EditorViewMode) => void;

  setDiagnostics: (path: string, diagnostics: Diagnostic[]) => void;
  clearDiagnostics: (path: string) => void;
  setDiagnosticsVisible: (visible: boolean) => void;

  setAiVisible: (visible: boolean) => void;
  setAiBusy: (busy: boolean) => void;
  setAiProvider: (provider: AiProviderInfo | null) => void;
  appendAiMessage: (message: AiMessage) => void;
  updateAiMessage: (id: string, patch: Partial<AiMessage>) => void;
  clearAiMessages: () => void;

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
  editorViewMode: "code",

  diagnostics: {},
  diagnosticsVisible: true,

  aiVisible: true,
  aiMessages: [],
  aiBusy: false,
  aiProvider: null,

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
      const activeTab =
        state.activeTab === path
          ? openTabs.length > 0
            ? openTabs[openTabs.length - 1].path
            : null
          : state.activeTab;
      return { openTabs, sessions, diagnostics, activeTab };
    }),

  closeAllTabs: () =>
    set({
      openTabs: [],
      sessions: {},
      diagnostics: {},
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
  setEditorViewMode: (editorViewMode) => set({ editorViewMode }),

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
  setDiagnosticsVisible: (diagnosticsVisible) => set({ diagnosticsVisible }),

  setAiVisible: (aiVisible) => set({ aiVisible }),
  setAiBusy: (aiBusy) => set({ aiBusy }),
  setAiProvider: (aiProvider) => set({ aiProvider }),
  appendAiMessage: (message) =>
    set((state) => ({ aiMessages: [...state.aiMessages, message] })),
  updateAiMessage: (id, patch) =>
    set((state) => ({
      aiMessages: state.aiMessages.map((m) =>
        m.id === id ? { ...m, ...patch } : m
      ),
    })),
  clearAiMessages: () => set({ aiMessages: [] }),

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
  return Object.values(state.diagnostics).flat();
}

export function selectDirtyCount(state: WorkbenchState): number {
  return Object.values(state.sessions).filter((s) => s.isDirty).length;
}
