// Preview pane. Dispatches to the right renderer based on the active tab's
// adapter. Re-parses + creates the preview model on a debounced cadence so
// the preview never blocks the editor.

"use client";

import { useWorkbench } from "@/features/workbench/store";
import { useDebounced } from "@/features/workbench/hooks";
import { documentRegistry } from "@/documents/core/registry";
import type { PreviewModel } from "@/documents/core/types";
import { useMemo } from "react";
import { MarkdownRenderer } from "@/lib/preview-renderers/markdown-renderer";
import { StructuredDataRenderer } from "@/lib/preview-renderers/structured-data-renderer";
import { MermaidRenderer } from "@/lib/preview-renderers/mermaid-renderer";
import { XmlTreeRenderer } from "@/lib/preview-renderers/xml-tree-renderer";
import { TextFallbackRenderer } from "@/lib/preview-renderers/text-fallback-renderer";
import { TableRenderer } from "@/lib/preview-renderers/table-renderer";
import { SvgRenderer } from "@/lib/preview-renderers/svg-renderer";
import { CodePreviewRenderer } from "@/lib/preview-renderers/code-preview-renderer";
import { DiffPreviewRenderer } from "@/lib/preview-renderers/diff-preview-renderer";
import { ArchifyPreview } from "@/features/workbench/preview/archify/archify-preview";
import { AlertCircle, Eye } from "lucide-react";

export function PreviewPane() {
  const activeTab = useWorkbench((s) => s.activeTab);
  const session = useWorkbench((s) =>
    s.activeTab ? s.sessions[s.activeTab] : null
  );
  const previewMode = useWorkbench((s) => s.previewMode);
  const setPreviewMode = useWorkbench((s) => s.setPreviewMode);

  const draftText = session?.draftText ?? "";
  const debouncedText = useDebounced(draftText, 200);
  // Keyed on the path, not the session object: the session changes on every keystroke,
  // and the preview model should only be rebuilt once the debounced text changes.
  const sessionPath = session?.path ?? null;

  const preview = useMemo<PreviewModel | null>(() => {
    if (sessionPath === null) return null;
    const adapter = documentRegistry.resolveForContent(sessionPath, debouncedText);
    try {
      return adapter.createPreview(debouncedText, sessionPath);
    } catch (err) {
      return {
        kind: "text-fallback",
        source: `Error rendering preview: ${(err as Error).message}`,
        language: "plaintext",
      };
    }
  }, [debouncedText, sessionPath]);

  if (!activeTab || !session || !preview) {
    return (
      <div className="flex h-full flex-col bg-card">
        <PreviewHeader title="Preview" path={null} mode={previewMode} setMode={setPreviewMode} />
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          No file open
        </div>
      </div>
    );
  }

  if (!documentRegistry.isSupported(session.path)) {
    return (
      <div className="flex h-full flex-col bg-card">
        <PreviewHeader title="Unsupported file" path={session.path} mode={previewMode} setMode={setPreviewMode} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
          <AlertCircle className="h-6 w-6 opacity-40 text-muted-foreground" />
          <div className="font-semibold text-foreground">No preview available</div>
          <div>This file format is not supported for preview.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-card">
      <PreviewHeader
        title={previewTitle(preview)}
        path={session.path}
        mode={previewMode}
        setMode={setPreviewMode}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {previewMode === "source" ? (
          <pre className="h-full overflow-auto p-4 text-xs leading-relaxed">
            <code>{debouncedText}</code>
          </pre>
        ) : (
          <PreviewContent preview={preview} />
        )}
      </div>
    </div>
  );
}

function PreviewContent({ preview }: { preview: PreviewModel }) {
  switch (preview.kind) {
    case "markdown":
      return <MarkdownRenderer source={preview.source} />;
    case "structured-data":
      return <StructuredDataRenderer value={preview.value} format={preview.format} />;
    case "diagram":
      if (preview.engine === "mermaid") return <MermaidRenderer source={preview.source} />;
      return <TextFallbackRenderer source={`Unsupported diagram engine: ${preview.engine}`} language="plaintext" />;
    case "xml-tree":
      return <XmlTreeRenderer source={preview.source} value={preview.value} />;
    case "sandboxed-html":
      return (
        <iframe
          title="HTML preview"
          sandbox="allow-scripts allow-downloads"
          allow="clipboard-write"
          allowFullScreen
          referrerPolicy="no-referrer"
          srcDoc={preview.source}
          className="h-full w-full border-0 bg-white"
        />
      );
    case "table":
      return <TableRenderer preview={preview} />;
    case "svg":
      return <SvgRenderer source={preview.source} />;
    case "code":
      return <CodePreviewRenderer source={preview.source} language={preview.language} />;
    case "diff":
      return <DiffPreviewRenderer source={preview.source} />;
    case "text-fallback":
      return <TextFallbackRenderer source={preview.source} language={preview.language} />;
    case "archify":
      return (
        // Keyed by file: last-good state must never carry over from one document to another.
        <ArchifyPreview
          key={preview.filePath}
          source={preview.source}
          diagramType={preview.diagramType}
          filePath={preview.filePath}
        />
      );
    default:
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          <AlertCircle className="mr-2 h-4 w-4" />
          Unknown preview kind
        </div>
      );
  }
}

function previewTitle(preview: PreviewModel): string {
  switch (preview.kind) {
    case "markdown":
      return "Rendered Markdown";
    case "structured-data":
      return `Structured data (${preview.format})`;
    case "diagram":
      return `Diagram (${preview.engine})`;
    case "xml-tree":
      return "XML tree";
    case "sandboxed-html":
      return "HTML preview";
    case "table":
      return `Table (${preview.format.toUpperCase()})`;
    case "svg":
      return "SVG graphic";
    case "code":
      return `${preview.language.toUpperCase()} preview`;
    case "diff":
      return "Diff preview";
    case "text-fallback":
      return "Preview";
    case "archify":
      return `Archify · ${preview.diagramType}`;
  }
}

function PreviewHeader({
  title,
  path,
  mode,
  setMode,
}: {
  title: string;
  path: string | null;
  mode: "preview" | "source";
  setMode: (mode: "preview" | "source") => void;
}) {
  return (
    <div className="flex h-9 items-center justify-between border-b bg-muted/30 px-3">
      <div className="flex items-center gap-2 overflow-hidden">
        <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold">{title}</span>
        {path && <span className="truncate text-[11px] text-muted-foreground">· {path}</span>}
      </div>
      <div className="flex items-center gap-1 rounded-md border bg-background p-0.5 text-[10px]">
        <button
          className={mode === "preview" ? "rounded bg-primary px-2 py-0.5 text-primary-foreground" : "px-2 py-0.5 text-muted-foreground"}
          onClick={() => setMode("preview")}
        >
          Preview
        </button>
        <button
          className={mode === "source" ? "rounded bg-primary px-2 py-0.5 text-primary-foreground" : "px-2 py-0.5 text-muted-foreground"}
          onClick={() => setMode("source")}
        >
          Source
        </button>
      </div>
    </div>
  );
}
