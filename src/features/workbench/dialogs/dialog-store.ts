// Asks the user for a decision in the app's own dialogs instead of the browser's
// alert, confirm and prompt. Each request is a promise, so callers read as
// `if (!(await confirmAction(...))) return;`. Requests queue, and one is shown at a time.

import { create } from "zustand";

export interface ConfirmOptions {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
}

export interface PromptOptions {
  readonly title: string;
  readonly description?: string;
  readonly label: string;
  readonly initialValue?: string;
  readonly placeholder?: string;
  readonly confirmLabel?: string;
  readonly multiline?: boolean;
  /** Returns an error message to block the submit, or null when the value is acceptable. */
  readonly validate?: (value: string) => string | null;
}

export type PendingDialog =
  | { readonly kind: "confirm"; readonly id: number; readonly options: ConfirmOptions; readonly resolve: (value: boolean) => void }
  | { readonly kind: "prompt"; readonly id: number; readonly options: PromptOptions; readonly resolve: (value: string | null) => void };

interface DialogState {
  readonly queue: readonly PendingDialog[];
  enqueue(dialog: PendingDialog): void;
  dequeue(id: number): void;
}

export const useDialogStore = create<DialogState>((set) => ({
  queue: [],
  enqueue: (dialog) => set((state) => ({ queue: [...state.queue, dialog] })),
  dequeue: (id) => set((state) => ({ queue: state.queue.filter((d) => d.id !== id) })),
}));

let nextId = 1;

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().enqueue({ kind: "confirm", id: nextId++, options, resolve });
  });
}

/** Resolves with the entered text, or null when the user cancels. */
export function promptText(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().enqueue({ kind: "prompt", id: nextId++, options, resolve });
  });
}
