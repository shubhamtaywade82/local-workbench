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

  const preview = useMemo<PreviewModel | null>(() => {
    if (!session) return null;
    const adapter = documentRegistry.resolve(session.path);
    try {
      return adapter.createPreview(debouncedText, session.path);
    } catch (err) {
      return {
        kind: "text-fallback",
        source: `Error rendering preview: ${(err as Error).message}`,
        language: "plaintext",
      };
    }
  }, [debouncedText, session]);

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
          sandbox="allow-same-origin"
          srcDoc={preview.source}
          className="h-full w-full border-0 bg-white"
        />
      );
    case "text-fallback":
      return <TextFallbackRenderer source={preview.source} language={preview.language} />;
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
    case "text-fallback":
      return "Preview";
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
