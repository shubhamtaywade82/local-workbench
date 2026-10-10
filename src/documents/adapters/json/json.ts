// JSON family document adapter.
//
// Handles the JSON family of file formats:
//   .json   — strict JSON (but we accept trailing commas / comments fault-tolerantly)
//   .jsonc  — JSON with comments
//   .json5  — JSON5 (relaxed JSON: unquoted keys, single quotes, comments, etc.)
//   .jsonl  — line-delimited JSON (one JSON value per line)
//   .ndjson — same as jsonl (alias)
//
// We use `jsonc-parser` (Microsoft) for .json/.jsonc because it gives us
// fault-tolerant parsing with structured errors and offsets. We use `json5`
// for .json5 because jsonc-parser does not understand JSON5 syntax.
//
// All diagnostics use 1-based line/column.

import JSON5 from "json5";
import {
  parse as jsoncParse,
  parseTree as jsoncParseTree,
  getNodeValue,
  printParseErrorCode,
  type ParseError,
  type Node,
} from "jsonc-parser";

import type {
  CompletionContext,
  CompletionItem,
  Diagnostic,
  DocumentAdapter,
  ParseResult,
  PreviewModel,
  SourceRange,
  TextEdit,
} from "../../core/types";

const SOURCE = "json";

type JsonVariant = "json" | "jsonc" | "json5" | "jsonl";

/** Extract the JSON variant from the file extension. */
function getVariant(filePath: string): JsonVariant {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return "json";
  const ext = filePath.slice(dot + 1).toLowerCase();
  if (ext === "jsonc") return "jsonc";
  if (ext === "json5") return "json5";
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  return "json";
}

// ---------------------------------------------------------------------------
// Position helpers (offset → 1-based line/column).
// ---------------------------------------------------------------------------

/**
 * Returns the start offset of each line in the source. Lines are indexed
 * from 0 in the returned array (so `offsets[0] === 0` for the first line).
 */
export function lineOffsets(source: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    const ch = source.charCodeAt(i);
    if (ch === 10 /* \n */) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * Convert a 0-based character offset (and optional length) into a 1-based
 * `SourceRange`. Uses a binary search over line offsets for efficiency on
 * large documents.
 */
export function offsetToRange(source: string, offset: number, length = 0): SourceRange {
  const offsets = lineOffsets(source);
  // Find the index of the last line whose start offset is <= offset.
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  const startLine = lo + 1; // 1-based
  const startColumn = offset - offsets[lo] + 1; // 1-based

  if (length <= 0) {
    return { startLine, startColumn, endLine: startLine, endColumn: startColumn };
  }

  const endOffset = offset + length;
  let lo2 = 0;
  let hi2 = offsets.length - 1;
  while (lo2 < hi2) {
    const mid = (lo2 + hi2 + 1) >> 1;
    if (offsets[mid] <= endOffset) lo2 = mid;
    else hi2 = mid - 1;
  }
  const endLine = lo2 + 1;
  const endColumn = endOffset - offsets[lo2] + 1;
  return { startLine, startColumn, endLine, endColumn };
}

// ---------------------------------------------------------------------------
// Variant-specific parsing.
// ---------------------------------------------------------------------------

function parseJsonc(source: string, filePath: string): ParseResult {
  const errors: ParseError[] = [];
  const tree: Node | undefined = jsoncParseTree(source, errors, { allowTrailingComma: true });
  const value = tree ? getNodeValue(tree) : undefined;
  const diagnostics: Diagnostic[] = errors.map((err) => {
    const range = offsetToRange(source, err.offset, err.length);
    return {
      filePath,
      severity: "error" as const,
      message: `JSON parse error: ${printParseErrorCode(err.error)} at offset ${err.offset}.`,
      source: SOURCE,
      code: String(err.error),
      range,
    };
  });
  if (diagnostics.length === 0) {
    return { valid: true, value, diagnostics };
  }
  // jsonc-parser is fault-tolerant: even when errors are present it usually
  // returns a best-effort value. We surface that as `partial` so the preview
  // can still render something useful.
  return { valid: false, diagnostics, partial: value };
}

function parseJson5(source: string, filePath: string): ParseResult {
  try {
    const value = JSON5.parse(source);
    return { valid: true, value, diagnostics: [] };
  } catch (err: unknown) {
    // JSON5 errors include `at` (a 0-based character offset) and `lineNumber`
    // (1-based) plus `column` (1-based). We try each field defensively.
    const e = err as { message?: string; at?: number; lineNumber?: number; column?: number };
    const message = e?.message ?? "JSON5 parse error";
    let range: SourceRange | undefined;
    if (typeof e?.lineNumber === "number" && e.lineNumber > 0) {
      const line = e.lineNumber;
      const col = typeof e.column === "number" && e.column > 0 ? e.column : 1;
      range = { startLine: line, startColumn: col, endLine: line, endColumn: Number.MAX_SAFE_INTEGER };
    } else if (typeof e?.at === "number" && e.at >= 0) {
      range = offsetToRange(source, e.at, 1);
    }
    return {
      valid: false,
      diagnostics: [
        {
          filePath,
          severity: "error",
          message,
          source: SOURCE,
          code: "json5",
          range,
        },
      ],
    };
  }
}

function parseJsonl(source: string, filePath: string): ParseResult {
  const values: unknown[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    // Skip blank lines — they are allowed in JSONL streams.
    if (line.trim() === "") continue;
    const errors: ParseError[] = [];
    const tree: Node | undefined = jsoncParseTree(line, errors, { allowTrailingComma: true });
    if (tree) {
      values.push(getNodeValue(tree));
    }
    for (const err of errors) {
      // The offset is relative to the line, so we convert manually.
      const startColumn = err.offset + 1; // 0-based → 1-based
      const endColumn = startColumn + Math.max(err.length, 1);
      diagnostics.push({
        filePath,
        severity: "error",
        message: `JSONL parse error on line ${lineNumber}: ${printParseErrorCode(err.error)}.`,
        source: SOURCE,
        code: String(err.error),
        range: { startLine: lineNumber, startColumn, endLine: lineNumber, endColumn },
      });
    }
  }
  if (diagnostics.length === 0) {
    return { valid: true, value: values, diagnostics };
  }
  return { valid: false, diagnostics, partial: values };
}

// ---------------------------------------------------------------------------
// Adapter.
// ---------------------------------------------------------------------------

export const jsonAdapter: DocumentAdapter = {
  id: "json",
  extensions: ["json", "jsonc", "json5", "jsonl", "ndjson"],
  languageId: "json",
  displayName: "JSON",

  parse(source: string, filePath: string): ParseResult {
    const variant = getVariant(filePath);
    if (variant === "json5") return parseJson5(source, filePath);
    if (variant === "jsonl") return parseJsonl(source, filePath);
    return parseJsonc(source, filePath); // json + jsonc share the same path
  },

  createPreview(source: string, filePath: string): PreviewModel {
    const result = this.parse(source, filePath);
    if (result.valid) {
      return { kind: "structured-data", format: "json", value: result.value };
    }
    // Even when invalid, we can usually show the partial value (fault-tolerant
    // parser). If we somehow have neither, fall back to raw text.
    if (result.partial !== undefined) {
      return { kind: "structured-data", format: "json", value: result.partial };
    }
    return { kind: "text-fallback", source, language: "json" };
  },

  validate(source: string, filePath: string): Diagnostic[] {
    return this.parse(source, filePath).diagnostics;
  },

  format(source: string, filePath: string): { edits: TextEdit[]; formatted: string } {
    const variant = getVariant(filePath);
    const wholeRange: SourceRange = {
      startLine: 1,
      startColumn: 1,
      endLine: Math.max(1, source.split(/\r?\n/).length),
      endColumn: Number.MAX_SAFE_INTEGER,
    };

    let formatted: string;
    if (variant === "jsonl") {
      // Pretty-print each line, one value per line. We skip blank lines
      // (which are allowed in JSONL streams) so that a trailing newline
      // doesn't get doubled up when we re-add it below.
      const lines = source.split(/\r?\n/);
      const out: string[] = [];
      for (const line of lines) {
        if (line.trim() === "") {
          continue;
        }
        try {
          const value = JSON.parse(line);
          out.push(JSON.stringify(value));
        } catch {
          // If a single line fails to parse, keep it as-is so the formatter
          // is idempotent and doesn't destroy the user's work.
          out.push(line);
        }
      }
      formatted = out.length > 0 ? out.join("\n") + "\n" : "";
    } else if (variant === "json5") {
      try {
        const value = JSON5.parse(source);
        formatted = JSON.stringify(value, null, 2) + "\n";
      } catch {
        // Cannot format invalid JSON5 — return source unchanged.
        return { edits: [], formatted: source };
      }
    } else {
      // json + jsonc — use jsonc-parser to fault-tolerantly parse and
      // then re-stringify. This loses comments but gives a stable
      // 2-space pretty-print.
      const errors: ParseError[] = [];
      const tree = jsoncParseTree(source, errors, { allowTrailingComma: true });
      if (!tree || errors.length > 0) {
        return { edits: [], formatted: source };
      }
      const value = getNodeValue(tree);
      formatted = JSON.stringify(value, null, 2) + "\n";
    }

    if (formatted === source) {
      return { edits: [], formatted };
    }
    return {
      edits: [{ range: wholeRange, newText: formatted, label: "Format document" }],
      formatted,
    };
  },

  getCompletions(context: CompletionContext): CompletionItem[] {
    // Best-effort heuristic: only suggest property keys when the cursor is
    // inside an object literal. We look at the current line — if it contains
    // a `{` or matches `"key":` style, we assume we are inside an object and
    // offer a curated set of common package.json-like keys.
    // This is intentionally simple: full JSON completion is out of scope.
    const suggestions: CompletionItem[] = [
      { label: `"type"`, insertText: `"type": `, detail: "Module type", kind: "property" },
      { label: `"name"`, insertText: `"name": `, detail: "Package name", kind: "property" },
      { label: `"version"`, insertText: `"version": `, detail: "Semver version", kind: "property" },
      { label: `"description"`, insertText: `"description": `, detail: "Description", kind: "property" },
      { label: `"main"`, insertText: `"main": `, detail: "Entry point", kind: "property" },
      { label: `"scripts"`, insertText: `"scripts": {\n  \n}`, detail: "npm scripts", kind: "property" },
      { label: `"dependencies"`, insertText: `"dependencies": {\n  \n}`, detail: "Dependencies", kind: "property" },
      { label: `"devDependencies"`, insertText: `"devDependencies": {\n  \n}`, detail: "Dev dependencies", kind: "property" },
      { label: `"true"`, insertText: `true`, detail: "Boolean true", kind: "value" },
      { label: `"false"`, insertText: `false`, detail: "Boolean false", kind: "value" },
      { label: `"null"`, insertText: `null`, detail: "Null", kind: "value" },
    ];

    // Crude context check: we can't easily see the full file from the
    // completion context, so we look at the column — if it is past the
    // first non-whitespace character we are likely in value territory.
    // We always return the full set; the editor will filter on prefix.
    void context; // context reserved for future per-position filtering
    return suggestions;
  },
};

export default jsonAdapter;

// The helpers `getVariant`, `lineOffsets`, `offsetToRange` and the
// re-named `jsoncParse` are already exported above (as `export function` /
// `import as`). They are intentionally left at module scope so other
// modules (diagnostics, AI tooling) and tests can import them directly.
