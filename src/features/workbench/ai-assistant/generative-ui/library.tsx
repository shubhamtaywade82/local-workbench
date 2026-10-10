"use client";

/**
 * React renderers for the workbench OpenUI component contract
 * (`src/lib/ai/generative-ui/components.ts`), built on the existing shadcn
 * primitives.
 *
 * Every renderer is defensive: while a response streams, props can be partial
 * (truncated strings, missing optionals, null children), so all values are
 * coerced and capped. Model text is only ever rendered as React text nodes.
 */
import type { ReactNode } from "react";
import {
  createLibrary,
  useIsStreaming,
  useTriggerAction,
  type ComponentRenderProps,
  type Library,
} from "@openuidev/react-lang";
import { GitBranch, Info, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table as UiTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  COMPONENT_NAMES,
  GENERATIVE_UI_LIMITS,
  PROPOSE_EDIT_ACTION,
  ROOT_COMPONENT,
  defineGenerativeComponents,
  type GenerativeLeafProps,
  type GenerativeRenderers,
} from "@/lib/ai/generative-ui/components";

type AnyRenderer = (props: ComponentRenderProps<Record<string, unknown>>) => ReactNode;

function str(value: unknown, max: number = GENERATIVE_UI_LIMITS.maxTextChars): string {
  if (typeof value !== "string") return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function Children({ value, renderNode }: { value: unknown; renderNode: (v: unknown) => ReactNode }) {
  return <>{arr(value).map((child, i) => <div key={i}>{renderNode(child)}</div>)}</>;
}

const Stack: AnyRenderer = ({ props, renderNode }) => (
  <div className="flex flex-col gap-2">
    <Children value={props.children} renderNode={renderNode} />
  </div>
);

const Card: AnyRenderer = ({ props, renderNode }) => (
  <section className="rounded-md border bg-background/60 p-2">
    <div className="mb-1.5 text-[11px] font-semibold">{str(props.title, 200)}</div>
    <div className="flex flex-col gap-1.5">
      <Children value={props.children} renderNode={renderNode} />
    </div>
  </section>
);

const Text: AnyRenderer = ({ props }) => {
  const p = props as Partial<GenerativeLeafProps["Text"]>;
  return <p className="whitespace-pre-wrap break-words">{str(p.content)}</p>;
};

const CALLOUT_TONES = {
  info: { icon: Info, className: "border-sky-500/40 bg-sky-500/10" },
  warning: { icon: AlertTriangle, className: "border-amber-500/40 bg-amber-500/10" },
  error: { icon: XCircle, className: "border-red-500/40 bg-red-500/10" },
  success: { icon: CheckCircle2, className: "border-emerald-500/40 bg-emerald-500/10" },
} as const;

const Callout: AnyRenderer = ({ props }) => {
  const p = props as Partial<GenerativeLeafProps["Callout"]>;
  const tone = CALLOUT_TONES[p.tone as keyof typeof CALLOUT_TONES] ?? CALLOUT_TONES.info;
  const Icon = tone.icon;
  return (
    <div className={cn("flex gap-1.5 rounded border p-1.5", tone.className)}>
      <Icon className="mt-0.5 h-3 w-3 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{str(p.title, 300)}</div>
        {p.body ? <div className="whitespace-pre-wrap break-words text-muted-foreground">{str(p.body)}</div> : null}
      </div>
    </div>
  );
};

const KeyValue: AnyRenderer = ({ props }) => {
  const items = arr(props.items).slice(0, GENERATIVE_UI_LIMITS.maxKeyValueItems);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      {items.map((item, i) => {
        const it = (item ?? {}) as Record<string, unknown>;
        return (
          <div key={i} className="contents">
            <dt className="text-muted-foreground">{str(it.label, 200)}</dt>
            <dd className="break-words font-mono">{str(it.value, 1000)}</dd>
          </div>
        );
      })}
    </dl>
  );
};

const Table: AnyRenderer = ({ props }) => {
  const columns = arr(props.columns).slice(0, GENERATIVE_UI_LIMITS.maxTableColumns).map((c) => str(c, 200));
  const rows = arr(props.rows).slice(0, GENERATIVE_UI_LIMITS.maxTableRows).map(arr);
  return (
    <div className="max-h-64 overflow-auto rounded border">
      <UiTable className="text-[10px]">
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => (
              <TableHead key={i} className="h-6 px-1.5">{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, r) => (
            <TableRow key={r}>
              {columns.map((_, c) => (
                <TableCell key={c} className="px-1.5 py-1 font-mono">{str(row[c], 1000)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </UiTable>
    </div>
  );
};

const CodeBlock: AnyRenderer = ({ props }) => {
  const p = props as Partial<GenerativeLeafProps["CodeBlock"]>;
  return (
    <div className="rounded border bg-muted/40">
      {p.language ? (
        <div className="border-b px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">{str(p.language, 40)}</div>
      ) : null}
      <pre className="max-h-64 overflow-auto p-1.5 text-[10px] leading-tight">
        <code>{str(p.code, GENERATIVE_UI_LIMITS.maxCodeChars)}</code>
      </pre>
    </div>
  );
};

/**
 * Never edits the document. It emits a `workbench.propose_edit` action; the
 * assistant panel turns that into the existing review-diff-then-apply flow.
 */
const ProposedEdit: AnyRenderer = ({ props }) => {
  const p = props as Partial<GenerativeLeafProps["ProposedEdit"]>;
  const triggerAction = useTriggerAction();
  const streaming = useIsStreaming();
  const label = str(p.label, 200) || "Proposed edit";
  const newText = typeof p.newText === "string" ? p.newText : "";
  const tooLarge = newText.length > GENERATIVE_UI_LIMITS.maxEditChars;
  return (
    <div className="rounded border bg-background/60 p-1.5">
      <div className="flex items-center gap-1 font-medium">
        <GitBranch className="h-3 w-3" />
        {label}
      </div>
      {p.description ? <div className="mt-0.5 text-muted-foreground">{str(p.description, 1000)}</div> : null}
      <Button
        size="sm"
        variant="outline"
        className="mt-1.5 h-6 text-[10px]"
        disabled={streaming || newText.length === 0 || tooLarge}
        title={tooLarge ? "Proposed content exceeds the size limit" : undefined}
        onClick={() =>
          triggerAction(`Review edit: ${label}`, undefined, {
            type: PROPOSE_EDIT_ACTION,
            params: { label, description: str(p.description, 1000), newText },
          })
        }
      >
        Review diff
      </Button>
    </div>
  );
};

const renderers: GenerativeRenderers<AnyRenderer> = {
  Stack,
  Card,
  Text,
  Callout,
  KeyValue,
  Table,
  CodeBlock,
  ProposedEdit,
};

const components = defineGenerativeComponents(renderers);

export const workbenchLibrary: Library = createLibrary({
  root: ROOT_COMPONENT,
  components: COMPONENT_NAMES.map((name) => components[name]),
});
