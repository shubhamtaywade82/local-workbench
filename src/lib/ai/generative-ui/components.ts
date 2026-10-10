/**
 * Generative UI (OpenUI Lang) component contract — the single source of truth
 * for component names, descriptions and prop schemas.
 *
 * Isomorphic and React-free: the server builds the system prompt from it with
 * placeholder renderers, the client attaches the real React renderers. Because
 * both sides go through `defineGenerativeComponents`, the prompt the model sees
 * and the components the Renderer can draw can never drift apart.
 *
 * Containment is deliberately shallow (Stack > Card > leaf) — small local
 * models follow flat trees far more reliably than recursive ones.
 */
import { z } from "zod";
import { defineComponent, type DefinedComponent } from "@openuidev/lang-core";

/** Hard caps that bound what a model response can make the UI render. */
export const GENERATIVE_UI_LIMITS = {
  maxTextChars: 8_000,
  maxCodeChars: 50_000,
  maxEditChars: 500_000,
  maxTableRows: 200,
  maxTableColumns: 12,
  maxKeyValueItems: 100,
} as const;

export const COMPONENT_NAMES = [
  "Stack",
  "Card",
  "Text",
  "Callout",
  "KeyValue",
  "Table",
  "CodeBlock",
  "ProposedEdit",
] as const;
export type GenerativeComponentName = (typeof COMPONENT_NAMES)[number];

export const ROOT_COMPONENT: GenerativeComponentName = "Stack";

const leafProps = {
  Text: z.object({
    content: z.string().describe("Plain-text paragraph. No markdown."),
  }),
  Callout: z.object({
    tone: z.enum(["info", "warning", "error", "success"]),
    title: z.string(),
    body: z.string().optional(),
  }),
  KeyValue: z.object({
    items: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .describe("Short label/value pairs, e.g. document facts or settings."),
  }),
  Table: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())).describe("Each row has one string per column."),
  }),
  CodeBlock: z.object({
    language: z.string().describe("e.g. json, yaml, toml, xml, markdown, mermaid"),
    code: z.string(),
  }),
  // Required props first: args are positional, so an optional prop before a
  // required one would make `ProposedEdit("Fix", "<doc>")` bind the document
  // to `description`.
  ProposedEdit: z.object({
    label: z.string().describe("Short imperative title, e.g. 'Fix trailing comma'."),
    newText: z.string().describe("The COMPLETE new content of the active document."),
    description: z.string().optional(),
  }),
} satisfies Record<string, z.ZodObject>;

type LeafName = keyof typeof leafProps;

/** Prop types for renderer implementations (values may be partial while streaming). */
export type GenerativeLeafProps = { [K in LeafName]: z.infer<(typeof leafProps)[K]> };

/** Action type emitted by ProposedEdit; the only action the workbench acts on. */
export const PROPOSE_EDIT_ACTION = "workbench.propose_edit";

const descriptions: Record<GenerativeComponentName, string> = {
  Stack: "Root vertical layout. Holds Cards and leaf components in order.",
  Card: "Titled section grouping related leaf components.",
  Text: "A plain-text paragraph.",
  Callout: "Highlighted note. Use tone=warning for ambiguity or risk, error for defects.",
  KeyValue: "Compact list of label/value facts.",
  Table: "Tabular data with a header row.",
  CodeBlock: "Read-only code or document snippet shown with its language.",
  ProposedEdit:
    "A suggested change to the active document. The user reviews a diff and applies it; it is never applied automatically.",
};

/**
 * Renderer implementations keyed by component name. The server passes
 * placeholders; the client passes React components.
 */
export type GenerativeRenderers<C> = Record<GenerativeComponentName, C>;

export type GenerativeComponents<C> = {
  [K in GenerativeComponentName]: DefinedComponent<z.ZodObject, C>;
};

export function defineGenerativeComponents<C>(
  renderers: GenerativeRenderers<C>
): GenerativeComponents<C> {
  const leaf = {} as Record<LeafName, DefinedComponent<z.ZodObject, C>>;
  for (const name of Object.keys(leafProps) as LeafName[]) {
    leaf[name] = defineComponent({
      name,
      description: descriptions[name],
      props: leafProps[name],
      component: renderers[name],
    });
  }

  const leafRef = z.union(
    (Object.keys(leaf) as LeafName[]).map((name) => leaf[name].ref) as unknown as [
      z.ZodType,
      z.ZodType,
      ...z.ZodType[],
    ]
  );

  const Card = defineComponent({
    name: "Card",
    description: descriptions.Card,
    props: z.object({
      title: z.string(),
      children: z.array(leafRef),
    }),
    component: renderers.Card,
  });

  const Stack = defineComponent({
    name: "Stack",
    description: descriptions.Stack,
    props: z.object({
      children: z.array(z.union([Card.ref, leafRef])),
    }),
    component: renderers.Stack,
  });

  return { Stack, Card, ...leaf };
}

/** Workbench-specific rules appended after OpenUI's generated prompt (so they take precedence). */
export const GENERATIVE_UI_RULES: readonly string[] = [
  "Default to plain text. Only add an openui-lang block when structure genuinely helps: lists of issues, comparisons, document facts, tables, or a proposed edit.",
  "Every UI block MUST be fenced exactly as ```openui-lang ... ``` and its root statement MUST be `root = Stack([...])`.",
  "To show code or document snippets as text, use a normal fenced block with its language (```json, ```yaml, ...) OUTSIDE openui-lang, or a CodeBlock component inside it. Never put JSON/YAML documents directly into an openui-lang block as statements.",
  "Use ProposedEdit ONLY when the complete current document text was given to you in this conversation and you are confident; newText must be the complete corrected document, never a fragment or diff. If you have not seen the full document, do not use ProposedEdit.",
  "Never claim an edit was applied. The user applies edits after reviewing a diff.",
  "Keep UI blocks small: at most 3 Cards and 12 statements.",
];

export const GENERATIVE_UI_EXAMPLES: readonly string[] = [
  [
    "```openui-lang",
    'root = Stack([summary, issues])',
    'summary = Card("Overview", [facts])',
    'facts = KeyValue([{label: "Format", value: "YAML"}, {label: "Top-level keys", value: "3"}])',
    'issues = Callout("warning", "Ambiguous port", "`port` is a string here but a number in `prod`.")',
    "```",
  ].join("\n"),
];
