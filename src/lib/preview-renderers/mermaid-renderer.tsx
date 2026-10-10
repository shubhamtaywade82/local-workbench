// Mermaid diagram renderer. Loads the mermaid library dynamically on the
// client (it uses DOM APIs not available during SSR) and renders the source
// into an SVG string. Re-renders on source change with a short debounce.

"use client";

import { useEffect, useState, useRef, memo } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  source: string;
}

function MermaidRendererBase({ source }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "default",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        });
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source);
        if (cancelled) return;
        setError(null);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
      {loading && (
        <div className="text-xs text-muted-foreground">Rendering diagram…</div>
      )}
      {error && (
        <div className="flex flex-col items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <pre className="max-w-full overflow-auto rounded border bg-muted/40 p-2 text-[10px]">
            {error}
          </pre>
        </div>
      )}
      <div ref={containerRef} className="prose prose-sm dark:prose-invert max-w-full [&>svg]:max-w-full" />
    </div>
  );
}

export const MermaidRenderer = memo(MermaidRendererBase);
