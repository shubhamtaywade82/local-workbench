// State of the assistant panel: the thread, the provider status and the run in
// progress. A vanilla store, so the controller can drive it without React and
// the components subscribe to it through the zustand hook.

import { createStore, type StoreApi } from "zustand/vanilla";

import type { ThreadMessage, AssistantMessage } from "./types";

export interface ProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly available: boolean;
  readonly reason: string | null;
  readonly generativeUi: boolean;
}

export interface ActiveRun {
  readonly id: string;
  readonly assistantId: string;
  readonly controller: AbortController;
}

export interface AssistantState {
  readonly provider: ProviderInfo | null;
  readonly messages: readonly ThreadMessage[];
  readonly activeRun: ActiveRun | null;
  setProvider(provider: ProviderInfo | null): void;
  setMessages(messages: readonly ThreadMessage[]): void;
  setActiveRun(run: ActiveRun | null): void;
}

export type AssistantStore = StoreApi<AssistantState>;

export function createAssistantStore(): AssistantStore {
  return createStore<AssistantState>()((set) => ({
    provider: null,
    messages: [],
    activeRun: null,
    setProvider: (provider) => set({ provider }),
    setMessages: (messages) => set({ messages }),
    setActiveRun: (activeRun) => set({ activeRun }),
  }));
}

/** Replaces one assistant message, leaving the rest of the thread untouched. */
export function patchAssistant(messages: readonly ThreadMessage[], id: string, patch: Partial<AssistantMessage>): ThreadMessage[] {
  return messages.map((m) => (m.id === id && m.role === "assistant" ? { ...m, ...patch } : m));
}
