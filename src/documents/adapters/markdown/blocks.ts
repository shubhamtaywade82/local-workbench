// Markdown block model for inline editing. Splits a document into its top-level
// blocks and records each block's exact character range, so one block can be
// rewritten in the source without touching anything else. Offsets are
// JavaScript string indexes into the source, the same units Monaco and the
// editor store use.

import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface MarkdownBlock {
  /** mdast type of the top-level node: heading, paragraph, list, code, table, ... */
  kind: string;
  /** Start offset of the block in the source (inclusive). */
  start: number;
  /** End offset of the block in the source (exclusive). */
  end: number;
  /** The block's text: `source.slice(start, end)` at the time it was parsed. */
  source: string;
}

const parser = unified().use(remarkParse).use(remarkGfm);

/**
 * Top-level blocks of a Markdown document, in source order. Blank lines
 * between blocks belong to no block. Pure: the same input always gives the
 * same blocks.
 */
export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  if (source.length === 0) return [];
  const tree = parser.parse(source);
  const blocks: MarkdownBlock[] = [];
  for (const node of tree.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    blocks.push({ kind: node.type, start, end, source: source.slice(start, end) });
  }
  return blocks;
}

export type BlockEditResult = { ok: true; text: string } | { ok: false; reason: "changed" };

/**
 * Returns `draft` with `block` replaced by `replacement`.
 *
 * Refuses (`reason: "changed"`) when the text at the block's range no longer
 * matches the block, which means the draft changed after the block was parsed.
 * The replacement is written with the document's line endings, and trailing
 * newlines are dropped so the block keeps its boundary with the next block.
 */
export function applyBlockEdit(
  draft: string,
  block: MarkdownBlock,
  replacement: string,
): BlockEditResult {
  if (draft.slice(block.start, block.end) !== block.source) {
    return { ok: false, reason: "changed" };
  }
  const eol = draft.includes("\r\n") ? "\r\n" : "\n";
  let body = replacement.replace(/\r?\n/g, eol);
  while (body.endsWith(eol)) body = body.slice(0, -eol.length);
  return { ok: true, text: draft.slice(0, block.start) + body + draft.slice(block.end) };
}
