// IndexedDB persistence for the workbench.
//
// Stores:
//  - recent workspaces (handle metadata for FSA, plus name+createdAt)
//  - recovery drafts (unsaved content of dirty tabs keyed by workspace+path)
//  - settings (theme, layout, etc.)
//
// Persistence is best-effort: if IndexedDB is unavailable (private browsing,
// disabled), all operations no-op and return safe defaults.

"use client";

import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "workbench-store";
const DB_VERSION = 1;
const STORE_RECENT = "recent-workspaces";
const STORE_DRAFTS = "recovery-drafts";
const STORE_SETTINGS = "settings";

export interface RecentWorkspace {
  id: string;
  name: string;
  source: "file-system-access" | "in-memory";
  createdAt: number;
  lastOpenedAt: number;
  /** IndexedDB cannot store FileSystemHandle objects across sessions in all
   *  browsers — we keep the name only. The user must re-pick the folder. */
  handleName?: string;
}

export interface RecoveryDraft {
  id: string; // `${workspaceId}::${path}`
  workspaceId: string;
  path: string;
  content: string;
  savedContent: string;
  updatedAt: number;
}

export interface WorkbenchSettings {
  theme: "dark" | "light";
  explorerVisible: boolean;
  previewVisible: boolean;
  aiVisible: boolean;
  diagnosticsVisible: boolean;
}

let dbPromise: Promise<IDBPDatabase | null> | null = null;

function getDB(): Promise<IDBPDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_RECENT)) {
          db.createObjectStore(STORE_RECENT, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
          db.createObjectStore(STORE_DRAFTS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS);
        }
      },
    }).catch((err) => {
      console.error("Failed to open workbench IndexedDB:", err);
      return null;
    });
  }
  return dbPromise;
}

// --- Recent workspaces -----------------------------------------------------

export async function listRecentWorkspaces(): Promise<RecentWorkspace[]> {
  const db = await getDB();
  if (!db) return [];
  const all = (await db.getAll(STORE_RECENT)) as RecentWorkspace[];
  return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function addRecentWorkspace(
  entry: RecentWorkspace
): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.put(STORE_RECENT, entry);
}

export async function removeRecentWorkspace(id: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.delete(STORE_RECENT, id);
}

// --- Recovery drafts -------------------------------------------------------

export async function saveRecoveryDraft(draft: RecoveryDraft): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.put(STORE_DRAFTS, draft);
}

export async function listRecoveryDrafts(
  workspaceId: string
): Promise<RecoveryDraft[]> {
  const db = await getDB();
  if (!db) return [];
  const all = (await db.getAll(STORE_DRAFTS)) as RecoveryDraft[];
  return all.filter((d) => d.workspaceId === workspaceId);
}

export async function deleteRecoveryDraft(id: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.delete(STORE_DRAFTS, id);
}

export async function clearRecoveryDrafts(workspaceId: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const all = await listRecoveryDrafts(workspaceId);
  await Promise.all(all.map((d) => db.delete(STORE_DRAFTS, d.id)));
}

// --- Settings --------------------------------------------------------------

export async function loadSettings(): Promise<WorkbenchSettings | null> {
  const db = await getDB();
  if (!db) return null;
  return (await db.get(STORE_SETTINGS, "app")) as WorkbenchSettings | null;
}

export async function saveSettings(
  settings: WorkbenchSettings
): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.put(STORE_SETTINGS, settings, "app");
}
