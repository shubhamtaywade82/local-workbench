// The editor showing each open document, registered by the editor pane. AI
// edits go through the editor so they land on its undo stack, and selections
// reach the assistant without the assistant importing Monaco.

export interface EditorSelection {
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

export interface EditorHandle {
  readonly path: string;
  /** Replaces the whole text as one undoable edit. Returns false when the editor is not ready. */
  replaceAll(text: string): boolean;
  /** The current non-empty selection, or null. */
  selection(): EditorSelection | null;
}

const handles = new Map<string, EditorHandle>();

/** Registers the editor for `handle.path`. The returned function unregisters it. */
export function registerEditor(handle: EditorHandle): () => void {
  handles.set(handle.path, handle);
  return () => {
    if (handles.get(handle.path) === handle) handles.delete(handle.path);
  };
}

export function replaceInEditor(path: string, text: string): boolean {
  return handles.get(path)?.replaceAll(text) ?? false;
}

export function selectionIn(path: string): EditorSelection | null {
  return handles.get(path)?.selection() ?? null;
}
