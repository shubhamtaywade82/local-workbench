// SVG vector graphic preview renderer. Renders the SVG image visually
// with zoom scaling, background pattern options, and raw XML toggle.

"use client";

import { Code, Eye, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

function parseSvgDimensions(source: string): { width: string; height: string; viewBox: string } {
  const vbMatch = /viewBox=["']([^"']+)["']/i.exec(source);
  const wMatch = /\bwidth=["']([^"']+)["']/i.exec(source);
  const hMatch = /\bheight=["']([^"']+)["']/i.exec(source);
  return {
    width: wMatch ? wMatch[1] : "auto",
    height: hMatch ? hMatch[1] : "auto",
    viewBox: vbMatch ? vbMatch[1] : "none",
  };
}

function SvgControls({
  zoom,
  onZoomChange,
  showXml,
  onToggleXml,
}: {
  zoom: number;
  onZoomChange: (z: number) => void;
  showXml: boolean;
  onToggleXml: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onZoomChange(Math.max(0.25, zoom - 0.25))}
        className="rounded border border-border p-1 hover:bg-muted"
        title="Zoom out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <span className="w-12 text-center font-mono text-[11px]">{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        onClick={() => onZoomChange(Math.min(4, zoom + 0.25))}
        className="rounded border border-border p-1 hover:bg-muted"
        title="Zoom in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onZoomChange(1)}
        className="rounded border border-border p-1 hover:bg-muted"
        title="Reset zoom"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      <div className="mx-1 h-3.5 w-px bg-border" />
      <button
        type="button"
        onClick={onToggleXml}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
      >
        {showXml ? <Eye className="h-3 w-3" /> : <Code className="h-3 w-3" />}
        <span>{showXml ? "Graphic" : "XML"}</span>
      </button>
    </div>
  );
}

export function SvgRenderer({ source }: { source: string }) {
  const [zoom, setZoom] = useState(1);
  const [showXml, setShowXml] = useState(false);
  const dims = useMemo(() => parseSvgDimensions(source), [source]);

  const dataUri = useMemo(() => {
    return `data:image/svg+xml;utf8,${encodeURIComponent(source)}`;
  }, [source]);

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 p-2 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground font-mono text-[10px]">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 uppercase text-primary font-bold">SVG</span>
          <span>{dims.width} × {dims.height}</span>
          {dims.viewBox !== "none" && <span>viewBox: {dims.viewBox}</span>}
        </div>
        <SvgControls
          zoom={zoom}
          onZoomChange={setZoom}
          showXml={showXml}
          onToggleXml={() => setShowXml(!showXml)}
        />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {showXml ? (
          <pre className="overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
            <code>{source}</code>
          </pre>
        ) : (
          <div className="flex min-h-full items-center justify-center rounded-lg border border-border bg-muted/10 p-6">
            <img
              src={dataUri}
              alt="SVG Preview"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
              className="max-h-[80vh] max-w-full transition-transform duration-100"
            />
          </div>
        )}
      </div>
    </div>
  );
}
