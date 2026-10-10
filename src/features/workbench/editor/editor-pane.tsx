// Monaco editor pane. Loads @monaco-editor/react dynamically on the client
// to avoid SSR issues with Monaco's web workers.
//
// The @monaco-editor/react component manages its own model per `path` prop.
// We must NOT call `monaco.editor.createModel` ourselves for the active path
// or Monaco throws "Cannot add model because it already exists".

"use client";

import dynamic from "next/dynamic";
import { useWorkbench } from "@/features/workbench/store";
import { useEffect, useMemo, useRef } from "react";
import { useDebouncedWithPending } from "@/features/workbench/hooks";
import { documentRegistry } from "@/documents/core/registry";
import { EditorEmptyState } from "./editor-empty-state";
import type { Diagnostic } from "@/documents/core/types";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading editor…
      </div>
    ),
  }
);

// Type alias for Monaco editor instance + namespace.
type MonacoEditorInstance = {
  getModel: () => unknown;
  setValue: (v: string) => void;
  getValue: () => string;
  updateOptions: (opts: Record<string, unknown>) => void;
};
type MonacoNamespace = {
  editor: {
    setModelMarkers: (
      model: unknown,
      owner: string,
      markers: unknown[]
    ) => void;
  };
  // Monaco exposes MarkerSeverity at the namespace root, not under `editor`.
  MarkerSeverity: { Error: number; Warning: number; Info: number; Hint: number };
};

export function EditorPane() {
  const activeTab = useWorkbench((s) => s.activeTab);
  const session = useWorkbench((s) =>
    s.activeTab ? s.sessions[s.activeTab] : null
  );
  const updateDraft = useWorkbench((s) => s.updateDraft);
  const setDiagnostics = useWorkbench((s) => s.setDiagnostics);
  const diagnosticsVisible = useWorkbench((s) => s.diagnosticsVisible);
  const setDiagnosticsVisible = useWorkbench((s) => s.setDiagnosticsVisible);
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const monacoRef = useRef<MonacoNamespace | null>(null);
  // Track the draft text we last pushed INTO Monaco so we don't bounce.
  const lastPushedRef = useRef<string | null>(null);

  // Debounce the draft text so the preview & diagnostics don't run on every
  // keystroke.
  const draftText = session?.draftText ?? "";
  const { debounced: debouncedText, pending: parsePending } =
    useDebouncedWithPending(draftText, 200);

  // Parse + validate the debounced text and push diagnostics to the store +
  // Monaco markers.
  useEffect(() => {
    if (!session) return;
    const path = session.path;
    const adapter = documentRegistry.resolve(path);
    let diagnostics: Diagnostic[] = [];
    try {
      const result = adapter.parse(debouncedText, path);
      diagnostics = result.diagnostics;
      if (adapter.validate) {
        diagnostics = diagnostics.concat(adapter.validate(debouncedText, path));
      }
    } catch (err) {
      diagnostics = [
        {
          filePath: path,
          severity: "error",
          message: `Parser threw: ${(err as Error).message}`,
          source: "editor",
        },
      ];
    }
    // Stale guard.
    const current = useWorkbench.getState().sessions[path];
    if (!current || current.draftText !== debouncedText) {
      return;
    }
    setDiagnostics(path, diagnostics);
    if (monacoRef.current && editorRef.current) {
      const model = editorRef.current.getModel();
      const monaco = monacoRef.current;
      if (model) {
        const markers = diagnostics.map((d) => ({
          message: d.message,
          severity:
            d.severity === "error"
              ? monaco.MarkerSeverity.Error
              : d.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : d.severity === "info"
                  ? monaco.MarkerSeverity.Info
                  : monaco.MarkerSeverity.Hint,
          startLineNumber: d.range?.startLine ?? 1,
          startColumn: d.range?.startColumn ?? 1,
          endLineNumber: d.range?.endLine ?? d.range?.startLine ?? 1,
          endColumn: d.range?.endColumn ?? Number.MAX_SAFE_INTEGER,
          source: d.source,
          code: d.code,
        }));
        monaco.editor.setModelMarkers(model, "workbench", markers);
      }
    }
  }, [debouncedText, session, setDiagnostics]);

  // When the active session's draftText changes externally (AI fix, revert,
  // reload-from-disk) and Monaco's value is out of date, sync it.
  useEffect(() => {
    if (!session || !editorRef.current) return;
    if (lastPushedRef.current === session.draftText) return;
    const current = editorRef.current.getValue();
    if (current !== session.draftText) {
      editorRef.current.setValue(session.draftText);
    }
    lastPushedRef.current = session.draftText;
  }, [session?.draftText, session?.path, session]);

  const options = useMemo(
    () => ({
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      wordWrap: "off" as const,
      smoothScroll: false,
      cursorBlinking: "smooth" as const,
      cursorSmoothCaretAnimation: "on" as const,
      renderWhitespace: "selection" as const,
      bracketPairColorization: { enabled: true },
      formatOnPaste: false,
      formatOnType: false,
      stickyScroll: { enabled: true },
      inlineSuggest: { enabled: false },
      quickSuggestions: false,
    }),
    []
  );

  const theme = useWorkbench((s) => s.theme);
  const language = session
    ? documentRegistry.resolve(session.path).languageId
    : "plaintext";

  // onMount: keep refs for setting markers later. Do NOT call createModel —
  // @monaco-editor/react does that for us via the `path` prop.
  const onMount = (editor: MonacoEditorInstance, monaco: MonacoNamespace) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    if (session) {
      lastPushedRef.current = session.draftText;
    }
  };

  if (!activeTab || !session) {
    return <EditorEmptyState />;
  }

  return (
    <div className="relative h-full w-full bg-background">
      <MonacoEditor
        height="100%"
        theme={theme === "dark" ? "vs-dark" : "light"}
        path={session.path}
        language={language}
        value={session.draftText}
        onChange={(value) => {
          if (value === undefined) return;
          if (lastPushedRef.current === value) return;
          lastPushedRef.current = value;
          updateDraft(session.path, value);
        }}
        onMount={onMount}
        options={options}
      />
      {parsePending && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-muted/80 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur">
          parsing…
        </div>
      )}
      <button
        className="absolute bottom-3 right-3 z-10 rounded-md border bg-background/80 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur hover:bg-background"
        onClick={() => setDiagnosticsVisible(!diagnosticsVisible)}
      >
        Problems
      </button>
    </div>
  );
}
