// The app's single assistant: its store and controller, wired to the real
// provider endpoint, documents, dialogs and notifications. Components reach it
// through useAssistant.

"use client";

import { useStore } from "zustand";
import { v4 as uuid } from "uuid";

import { runAiTask } from "@/lib/ai/client/run-task";
import { snapshotWorkspace } from "@/features/workbench/ai/workspace-snapshot";
import { getActiveWorkspaceFs } from "@/platform/filesystem/use-workspace-controller";
import { confirmAction } from "@/features/workbench/dialogs/dialog-store";
import { notify } from "@/features/workbench/notify";
import { frameScheduler } from "@/features/workbench/ai/delta-buffer";

import { AssistantController } from "./assistant-controller";
import { createAssistantStore, type ProviderInfo } from "./assistant-store";
import { documentPort } from "./document-port";

async function fetchProvider(): Promise<ProviderInfo | null> {
  const response = await fetch("/api/ai/models", { cache: "no-store" });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    provider: { id: string; name: string; available: boolean; reason?: string | null };
    models: { id: string }[];
    features?: { generativeUi?: boolean };
  };
  return {
    id: data.provider.id,
    name: data.provider.name,
    model: data.models[0]?.id ?? "",
    available: data.provider.available,
    reason: data.provider.reason ?? null,
    generativeUi: data.features?.generativeUi === true,
  };
}

export const assistantStore = createAssistantStore();

let controller: AssistantController | null = null;

export function assistantController(): AssistantController {
  if (controller) return controller;
  controller = new AssistantController(assistantStore, {
    transport: runAiTask,
    documents: documentPort,
    workspaceExcerpts: async () => {
      const fs = getActiveWorkspaceFs();
      return fs ? snapshotWorkspace(fs) : [];
    },
    confirmReplace: (path, reason) =>
      confirmAction({
        title: reason === "stale" ? "The document changed" : "Replace the document?",
        description:
          reason === "stale"
            ? `${path} changed after this suggestion was made. Applying it replaces your newer text. Undo with Ctrl+Z if you change your mind.`
            : `${path} will be replaced with the diagram. Undo with Ctrl+Z if you change your mind.`,
        confirmLabel: reason === "stale" ? "Apply anyway" : "Replace",
        destructive: reason === "overwrite",
      }),
    notify,
    fetchProvider,
    newId: () => uuid(),
    now: () => Date.now(),
    scheduler: frameScheduler,
  });
  return controller;
}

/** The assistant's thread and provider state, re-rendering only when the slice it reads changes. */
export function useAssistantState<T>(select: (state: ReturnType<typeof assistantStore.getState>) => T): T {
  return useStore(assistantStore, select);
}
