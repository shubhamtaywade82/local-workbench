// Turns model output into the structures the runner returns. Each parser either
// returns a validated value or reports why it could not, so nothing guesses.

import { z } from "zod";

import type { ArchifyDiagramType } from "@/lib/archify/contract";

import { extractJson, stripCodeFence } from "../text";

import type { MermaidType, ReviewCandidate } from "./contract";

const fixSchema = z.object({
  label: z.string().min(1).max(120),
  description: z.string().max(1000).default(""),
  newText: z.string(),
});

export type FixParse =
  | { readonly structured: true; readonly label: string; readonly description: string; readonly newText: string }
  | { readonly structured: false; readonly newText: string };

/** A fix is a JSON object with the corrected document. Prose falls back to the text, flagged as unstructured. */
export function parseFixOutput(raw: string): FixParse {
  const result = fixSchema.safeParse(extractJson<unknown>(raw));
  if (result.success) return { structured: true, ...result.data };
  return { structured: false, newText: stripCodeFence(raw) };
}

export type ArchifyParse = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string };

/** One JSON object whose `diagram_type` is the requested type. Returned pretty-printed, as the document text. */
export function parseArchifyDocument(raw: string, expected: ArchifyDiagramType): ArchifyParse {
  const value = extractJson<unknown>(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: "The reply was not one JSON object." };
  }
  const declared = (value as Record<string, unknown>).diagram_type;
  if (declared !== expected) {
    return { ok: false, message: `diagram_type must be "${expected}", but the reply has ${JSON.stringify(declared) ?? "none"}.` };
  }
  return { ok: true, text: `${JSON.stringify(value, null, 2)}\n` };
}

const candidateSchema = z.object({
  title: z.string().min(1).max(160),
  strength: z.enum(["Strong", "Worth exploring", "Speculative"]),
  dependencyCategory: z.string().max(60).optional(),
  files: z.array(z.string().max(300)).max(12),
  problem: z.string().min(1).max(600),
  solution: z.string().min(1).max(600),
  wins: z.array(z.string().min(1).max(160)).max(6),
  beforeMermaid: z.string().min(1).max(4000),
  afterMermaid: z.string().min(1).max(4000),
});

const reviewSchema = z.object({
  summary: z.string().max(1000),
  candidates: z.array(candidateSchema).min(1).max(6),
});

export type ReviewParse =
  | { readonly ok: true; readonly summary: string; readonly candidates: readonly ReviewCandidate[] }
  | { readonly ok: false; readonly message: string };

export function parseReviewOutput(raw: string): ReviewParse {
  const value = extractJson<unknown>(raw);
  const result = reviewSchema.safeParse(value);
  if (result.success) return { ok: true, summary: result.data.summary, candidates: result.data.candidates };
  const first = result.error?.issues[0];
  return {
    ok: false,
    message: first ? `${first.path.join(".") || "reply"}: ${first.message}` : "The reply was not the review JSON.",
  };
}

export const MERMAID_OPENERS: Readonly<Record<MermaidType, string>> = {
  flowchart: "flowchart",
  sequence: "sequenceDiagram",
  state: "stateDiagram-v2",
  er: "erDiagram",
  class: "classDiagram",
};

/** Openers a diagram of each type may start with. `graph` is the legacy flowchart keyword, and it is valid. */
const MERMAID_ALIASES: Readonly<Record<MermaidType, readonly string[]>> = {
  flowchart: ["flowchart", "graph"],
  sequence: ["sequenceDiagram"],
  state: ["stateDiagram-v2", "stateDiagram"],
  er: ["erDiagram"],
  class: ["classDiagram"],
};

/**
 * Keeps the diagram from its opening keyword. Prose before the opener is
 * dropped, and a missing opener is added, so the output renders.
 */
export function normalizeMermaid(raw: string, type: MermaidType): string {
  const stripped = stripCodeFence(raw);
  const openers = MERMAID_ALIASES[type];
  const starts = openers
    .map((opener) => stripped.search(new RegExp(`(^|\\n)\\s*${opener}\\b`)))
    .filter((index) => index >= 0);
  if (starts.length > 0) {
    const first = Math.min(...starts);
    // Drop anything after a closing fence that followed the diagram.
    const body = stripped.slice(first).replace(/^\s+/, "");
    const closing = body.search(/\n\s*```/);
    return (closing === -1 ? body : body.slice(0, closing)).trim();
  }
  return `${MERMAID_OPENERS[type]}\n${stripped}`.trim();
}
