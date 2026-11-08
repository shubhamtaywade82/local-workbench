// Markdown preview renderer. Uses react-markdown + remark-gfm. Mermaid code
// fences are extracted BEFORE passing to react-markdown so we don't have to
// fight with react-markdown's code/pre component API.

"use client";

import { Check, Copy, Info, Lightbulb, AlertCircle, AlertTriangle, ShieldAlert, type LucideIcon } from "lucide-react";
import { Children, cloneElement, isValidElement, memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import { useWorkbench } from "@/features/workbench/store";
import { MermaidRenderer } from "./mermaid-renderer";

interface Props {
  source: string;
  /** Drops the outer padding and block spacing, for rendering one block inside another view. */
  bare?: boolean;
}

interface Segment {
  kind: "markdown" | "mermaid";
  text: string;
}

const CALLOUT_MAP: Record<string, { label: string; icon: LucideIcon; style: string }> = {
  NOTE: { label: "Note", icon: Info, style: "border-sky-500/50 bg-sky-500/10 text-sky-900 dark:text-sky-200" },
  TIP: { label: "Tip", icon: Lightbulb, style: "border-emerald-500/50 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200" },
  IMPORTANT: { label: "Important", icon: AlertCircle, style: "border-purple-500/50 bg-purple-500/10 text-purple-900 dark:text-purple-200" },
  WARNING: { label: "Warning", icon: AlertTriangle, style: "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200" },
  CAUTION: { label: "Caution", icon: ShieldAlert, style: "border-rose-500/50 bg-rose-500/10 text-rose-900 dark:text-rose-200" },
};

function splitMermaidSegments(source: string): Segment[] {
  const segments: Segment[] = [];
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

function CalloutBox({ kind, children }: { kind: string; children: ReactNode }) {
  const config = CALLOUT_MAP[kind];
  if (!config) return <blockquote className="my-3 border-l-4 border-primary/40 pl-4 italic text-muted-foreground">{children}</blockquote>;
  const Icon = config.icon;
  return (
    <div className={`my-4 rounded-lg border-l-4 p-3.5 ${config.style}`}>
      <div className="flex items-center gap-1.5 font-semibold text-xs tracking-wide uppercase mb-1">
        <Icon className="h-4 w-4 shrink-0" />
        <span>{config.label}</span>
      </div>
      <div className="text-sm not-italic opacity-90">{children}</div>
    </div>
  );
}

function BlockquoteRenderer({ children }: { children?: ReactNode }) {
  const childArray = Children.toArray(children);
  const pIndex = childArray.findIndex((c) => isValidElement(c) && c.type === "p");
  if (pIndex !== -1) {
    const pEl = childArray[pIndex] as React.ReactElement<{ children?: ReactNode }>;
    const pKids = Children.toArray(pEl.props.children);
    if (typeof pKids[0] === "string") {
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(pKids[0]);
      if (match) {
        const kind = match[1].toUpperCase();
        const trimmed = pKids[0].replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, "");
        const newKids = [trimmed, ...pKids.slice(1)];
        const newP = cloneElement(pEl, {}, ...newKids);
        const nextChildren = [...childArray.slice(0, pIndex), newP, ...childArray.slice(pIndex + 1)];
        return <CalloutBox kind={kind}>{nextChildren}</CalloutBox>;
      }
    }
  }
  return <blockquote className="my-3 border-l-4 border-primary/40 pl-4 italic text-muted-foreground">{children}</blockquote>;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const theme = useWorkbench((s) => s.theme);
  const codeEl = children as React.ReactElement<{ className?: string; children?: ReactNode }> | undefined;
  const className = codeEl?.props?.className ?? "";
  const codeText = String(codeEl?.props?.children ?? "").replace(/\n$/, "");
  const match = /language-([a-zA-Z0-9_-]+)/.exec(className);
  const language = match ? match[1].toLowerCase() : "text";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  return (
    <div className="group relative my-4 overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="flex h-8 items-center justify-between border-b border-border bg-muted/60 px-3 text-xs text-muted-foreground">
        <span className="font-mono text-[10px] uppercase tracking-wider">{language}</span>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-background/80 hover:text-foreground"
          title="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={theme === "dark" ? oneDark : oneLight}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "0.875rem 1rem",
          fontSize: "0.8125rem",
          background: "transparent",
        }}
      >
        {codeText}
      </SyntaxHighlighter>
    </div>
  );
}

function markdownClass(bare: boolean): string {
  const spacing = bare ? "" : "space-y-4 p-4 ";
  return `prose prose-sm dark:prose-invert max-w-none ${spacing}`;
}

function MarkdownSegment({ text }: { text: ReactNode }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre({ children }) {
          return <CodeBlock>{children}</CodeBlock>;
        },
        blockquote({ children }) {
          return <BlockquoteRenderer>{children}</BlockquoteRenderer>;
        },
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

function MarkdownRendererBase({ source, bare = false }: Props) {
  const segments = splitMermaidSegments(source);
  return (
    <div className={markdownClass(bare)}>
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

export const MarkdownRenderer = memo(MarkdownRendererBase);
