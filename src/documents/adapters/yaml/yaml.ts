// YAML document adapter.
//
// Uses the `yaml` npm package (eemeli.org/yaml) which preserves source
// positions and provides structured errors with optional `linePos` info.
//
// All diagnostics use 1-based line/column, matching Monaco's marker
// convention defined in `src/documents/core/types.ts`.

import { LineCounter, parseDocument } from "yaml";
import type { YAMLError } from "yaml";

import type {
  Diagnostic,
  DocumentAdapter,
  ParseResult,
  PreviewModel,
  SourceRange,
  TextEdit,
} from "../../core/types";

const SOURCE = "yaml";

/**
 * Convert a YAMLError into a Diagnostic. If `linePos` is present we use
 * the parser's exact line/column; otherwise we fall back to the (rare)
 * case where only a character `pos` is available and translate it via the
 * `LineCounter`.
 */
function yamlErrorToDiagnostic(
  err: YAMLError,
  filePath: string,
  lc: LineCounter | undefined,
): Diagnostic {
  let range: SourceRange | undefined;
  if (err.linePos && err.linePos.length > 0) {
    const start = err.linePos[0];
    const end = err.linePos[err.linePos.length - 1];
    range = {
      startLine: start.line,
      startColumn: start.col,
      endLine: end.line,
      endColumn: end.col,
    };
  } else if (lc && err.pos && err.pos.length > 0) {
    const start = lc.linePos(err.pos[0]);
    if (start) {
      const endOffset = err.pos[err.pos.length - 1];
      const end = lc.linePos(endOffset);
      range = {
        startLine: start.line,
        startColumn: start.col,
        endLine: end ? end.line : start.line,
        endColumn: end ? end.col : Number.MAX_SAFE_INTEGER,
      };
    }
  }
  return {
    filePath,
    severity: err.name === "YAMLWarning" ? "warning" : "error",
    message: err.message,
    source: SOURCE,
    code: err.code,
    range,
  };
}

/**
 * Parse YAML source. Returns a `ParseResult` with the JS value on success
 * or, on error, the partial value when the parser managed to produce one.
 */
function parseYaml(source: string, filePath: string): ParseResult {
  // Use a LineCounter so we can translate character offsets to line/column
  // for errors that don't carry `linePos` themselves.
  const lc = new LineCounter();
  // `parseDocument` is non-throwing — errors are collected on `doc.errors`.
  const doc = parseDocument(source, { lineCounter: lc, prettyErrors: true });

  const diagnostics: Diagnostic[] = [
    ...doc.errors.map((e) => yamlErrorToDiagnostic(e, filePath, lc)),
    ...doc.warnings.map((e) => yamlErrorToDiagnostic(e, filePath, lc)),
  ];

  if (diagnostics.length === 0) {
    return { valid: true, value: doc.toJS(), diagnostics };
  }

  // Try to produce a partial value. If aliasing is involved and fails, we
  // degrade gracefully and return no partial.
  let partial: unknown;
  try {
    partial = doc.toJS({ maxAliasCount: 100 });
  } catch {
    partial = undefined;
  }
  return { valid: false, diagnostics, partial };
}

export const yamlAdapter: DocumentAdapter = {
  id: "yaml",
  extensions: ["yaml", "yml"],
  languageId: "yaml",
  displayName: "YAML",

  parse(source: string, filePath: string): ParseResult {
    return parseYaml(source, filePath);
  },

  createPreview(source: string, filePath: string): PreviewModel {
    const result = parseYaml(source, filePath);
    if (result.valid) {
      return { kind: "structured-data", format: "yaml", value: result.value };
    }
    if (result.partial !== undefined) {
      return { kind: "structured-data", format: "yaml", value: result.partial };
    }
    return { kind: "text-fallback", source, language: "yaml" };
  },

  validate(source: string, filePath: string): Diagnostic[] {
    return parseYaml(source, filePath).diagnostics;
  },

  format(source: string, _filePath: string): { edits: TextEdit[]; formatted: string } {
    const lc = new LineCounter();
    const doc = parseDocument(source, { lineCounter: lc, prettyErrors: true });
    // We only re-emit if the document is parseable. Otherwise we leave the
    // source untouched (the formatter must be idempotent and safe).
    if (doc.errors.length > 0) {
      return { edits: [], formatted: source };
    }
    const formatted = doc.toString({ indent: 2, lineWidth: 80 });
    if (formatted === source) {
      return { edits: [], formatted };
    }
    const lineCount = Math.max(1, source.split(/\r?\n/).length);
    const wholeRange: SourceRange = {
      startLine: 1,
      startColumn: 1,
      endLine: lineCount,
      endColumn: Number.MAX_SAFE_INTEGER,
    };
    return {
      edits: [{ range: wholeRange, newText: formatted, label: "Format YAML" }],
      formatted,
    };
  },
};

export default yamlAdapter;
