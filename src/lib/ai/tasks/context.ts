// Builds the document context a model sees. Pure, so the budget rules are unit
// tested. The model always receives the document (or the part of it that fits)
// as delimited data, never as instructions.

import type { ChatTurn, DocumentSnapshot } from "./contract";

/** Characters of document text placed in one prompt. Large files are windowed. */
export const DOCUMENT_CONTEXT_CHARS = 48_000;

/** Lines always kept from the top of an excerpt: imports, titles, schema headers. */
const HEAD_LINES = 20;
const OMISSION_RESERVE = 400;

export interface DocumentExcerpt {
  readonly text: string;
  /** 1-based inclusive line span of the body window, excluding the head. */
  readonly windowFirstLine: number;
  readonly windowLastLine: number;
  readonly totalLines: number;
  readonly truncated: boolean;
}

/**
 * Returns the whole text when it fits the budget. Otherwise it keeps the first
 * lines and a window around `focusLine`, grown outwards until the budget is
 * spent, and marks each omitted span.
 */
export function excerptDocument(
  text: string,
  options: { budget?: number; focusLine?: number } = {}
): DocumentExcerpt {
  const budget = options.budget ?? DOCUMENT_CONTEXT_CHARS;
  const lines = text.split("\n");
  const total = lines.length;
  if (text.length <= budget) {
    return { text, windowFirstLine: 1, windowLastLine: total, totalLines: total, truncated: false };
  }

  // A head is kept only when the document has more lines than the head size.
  // Otherwise the whole document is one window, and its long lines are clipped.
  const headCount = total > HEAD_LINES ? HEAD_LINES : 0;
  const head = lines.slice(0, headCount);
  const headChars = head.reduce((sum, line) => sum + line.length + 1, 0);
  const bodyStart = headCount;
  const windowBudget = Math.max(0, budget - headChars - OMISSION_RESERVE);

  const focusIndex = clamp((options.focusLine ?? 1) - 1, bodyStart, total - 1);
  let lo = focusIndex;
  let hi = focusIndex;
  let used = lineCost(lines[focusIndex], windowBudget);
  for (;;) {
    let grew = false;
    if (lo - 1 >= bodyStart && used + lineCost(lines[lo - 1], windowBudget) <= windowBudget) {
      lo -= 1;
      used += lineCost(lines[lo], windowBudget);
      grew = true;
    }
    if (hi + 1 < total && used + lineCost(lines[hi + 1], windowBudget) <= windowBudget) {
      hi += 1;
      used += lineCost(lines[hi], windowBudget);
      grew = true;
    }
    if (!grew) break;
  }

  const parts: string[] = [head.join("\n")];
  if (lo > bodyStart) parts.push(`… lines ${bodyStart + 1}–${lo} omitted …`);
  const windowText = lines.slice(lo, hi + 1).map((line) => clipLine(line, windowBudget)).join("\n");
  parts.push(windowText);
  if (hi < total - 1) parts.push(`… lines ${hi + 2}–${total} omitted …`);

  return {
    text: parts.join("\n"),
    windowFirstLine: lo + 1,
    windowLastLine: hi + 1,
    totalLines: total,
    truncated: true,
  };
}

function lineCost(line: string, budget: number): number {
  return Math.min(line.length, budget) + 1;
}

function clipLine(line: string, budget: number): string {
  return line.length <= budget ? line : `${line.slice(0, Math.max(0, budget - 1))}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Escapes text so that document content cannot close its own data block. */
export function escapeDataBlock(text: string): string {
  return text.replace(/<\/document/gi, "<\\/document").replace(/<\/diagnostics/gi, "<\\/diagnostics");
}

function attribute(value: string): string {
  return value.replace(/[<>"&]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function formatDiagnostics(snapshot: DocumentSnapshot): string {
  const diagnostics = snapshot.diagnostics ?? [];
  if (diagnostics.length === 0) return "(none)";
  return diagnostics
    .map((d, i) => {
      const where = d.line !== undefined ? `line ${d.line}` : "unknown location";
      const code = d.code ? ` [${d.code}]` : "";
      return `${i + 1}. ${d.severity}${code} @ ${where}: ${d.message}`;
    })
    .join("\n");
}

export interface DocumentPromptBlock {
  readonly block: string;
  /** Human-readable note for the status line, when the document was windowed. */
  readonly note: string | null;
}

/**
 * The document as a delimited data block with its metadata. The instruction
 * that goes with it always says the block is data, not instructions.
 */
export function documentPromptBlock(snapshot: DocumentSnapshot, budget = DOCUMENT_CONTEXT_CHARS): DocumentPromptBlock {
  const focusLine = snapshot.selection?.startLine ?? snapshot.diagnostics?.find((d) => d.line)?.line;
  const excerpt = excerptDocument(snapshot.text, { budget, ...(focusLine !== undefined ? { focusLine } : {}) });
  const selection = snapshot.selection
    ? ` selection="lines ${snapshot.selection.startLine}-${snapshot.selection.endLine}"`
    : "";
  const note = excerpt.truncated
    ? `Only part of ${snapshot.path} is included (${excerpt.totalLines} lines in total).`
    : null;
  const block = [
    `<document path="${attribute(snapshot.path)}" format="${attribute(snapshot.adapterId)}" language="${attribute(snapshot.languageId)}"${selection} truncated="${excerpt.truncated}">`,
    escapeDataBlock(excerpt.text),
    "</document>",
  ].join("\n");
  return { block, note };
}

/** Keeps the newest turns that fit both limits. The oldest turns are dropped first. */
export function trimHistory(turns: readonly ChatTurn[], maxTurns: number, maxChars: number): ChatTurn[] {
  const recent = turns.slice(-maxTurns);
  const kept: ChatTurn[] = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const turn = recent[i];
    if (used + turn.content.length > maxChars) break;
    used += turn.content.length;
    kept.unshift(turn);
  }
  return kept;
}
