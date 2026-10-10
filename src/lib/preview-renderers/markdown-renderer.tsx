// Markdown preview renderer. Uses react-markdown + remark-gfm. Mermaid code
// fences are extracted BEFORE passing to react-markdown so we don't have to
// fight with react-markdown's `code`/`pre` component API.

"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidRenderer } from "./mermaid-renderer";
import { memo, Fragment, type ReactNode } from "react";

interface Props {
  source: string;
}

interface Segment {
  kind: "markdown" | "mermaid";
  text: string;
}

// Split a markdown source into segments: alternating markdown and mermaid
// blocks. Mermaid blocks are fenced with ```mermaid ... ``` (or ~~~mermaid).
function splitMermaidSegments(source: string): Segment[] {
  const segments: Segment[] = [];
  // Match ```mermaid\n...\n``` or ~~~mermaid\n...\n~~~
  const fenceRe = /(?:^|\n)(`{3,}|~{3,})mermaid[ \t]*\n([\s\S]*?)\n\1/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(source)) !== null) {
    const fenceStart = match.index + (match[0].startsWith("\n") ? 1 : 0);
    if (fenceStart > lastIndex) {
      segments.push({ kind: "markdown", text: source.slice(lastIndex, fenceStart) });
    }
    segments.push({ kind: "mermaid", text: match[2] });
    lastIndex = fenceStart + match[0].length;
  }
  if (lastIndex < source.length) {
    segments.push({ kind: "markdown", text: source.slice(lastIndex) });
  }
  return segments.length === 0 ? [{ kind: "markdown", text: source }] : segments;
}

function MarkdownRendererBase({ source }: Props) {
  const segments = splitMermaidSegments(source);
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none space-y-4 p-4 prose-headings:scroll-mt-16 prose-pre:rounded-md prose-pre:bg-muted/50 prose-pre:p-3 prose-pre:text-xs prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none prose-code:text-foreground">
      {segments.map((seg, i) =>
        seg.kind === "mermaid" ? (
          <MermaidRenderer key={`mmd-${i}`} source={seg.text} />
        ) : (
          <MarkdownSegment key={`md-${i}`} text={seg.text} />
        )
      )}
    </div>
  );
}

// A non-mermaid markdown segment. Uses react-markdown with the default
// renderers — we do NOT customize the `code` component to avoid react-markdown
// v10's strict nesting rules around <pre>/<code>/<p>.
function MarkdownSegment({ text }: { text: ReactNode }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ href, children, ...props }) {
          const external = href?.startsWith("http");
          return (
            <a
              href={href}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
              {...props}
            >
              {children}
            </a>
          );
        },
      }}
    >
      {text as string}
    </ReactMarkdown>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererBase);
// Keep the Fragment import referenced for tree-shaking's sake.
void Fragment;
