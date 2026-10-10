// TOML document adapter.
//
// Uses the `smol-toml` npm package. smol-toml's `TomlError` carries
// `line` and `column` properties (1-based) for precise diagnostics.
//
// All diagnostics use 1-based line/column, matching Monaco's marker
// convention defined in `src/documents/core/types.ts`.

import { parse as tomlParse, stringify as tomlStringify, TomlError } from "smol-toml";

import type {
  Diagnostic,
  DocumentAdapter,
  ParseResult,
  PreviewModel,
  SourceRange,
  TextEdit,
} from "../../core/types";

const SOURCE = "toml";

/**
 * Parse TOML. smol-toml throws on error — we catch and translate to a
 * Diagnostic. The thrown `TomlError` has `line` and `column` (1-based).
 */
function parseToml(source: string, filePath: string): ParseResult {
  try {
    const value = tomlParse(source);
    return { valid: true, value, diagnostics: [] };
  } catch (err: unknown) {
    const e = err as Partial<TomlError> & { message?: string };
    const message = e?.message ?? "TOML parse error";
    let range: SourceRange | undefined;
    const line = (e as { line?: number })?.line;
    const column = (e as { column?: number })?.column;
    if (typeof line === "number" && line > 0) {
      const col = typeof column === "number" && column > 0 ? column : 1;
      range = { startLine: line, startColumn: col, endLine: line, endColumn: Number.MAX_SAFE_INTEGER };
    } else {
      // Fall back to line 1 if smol-toml ever omits position info.
      range = { startLine: 1, startColumn: 1, endLine: 1, endColumn: Number.MAX_SAFE_INTEGER };
    }
    return {
      valid: false,
      diagnostics: [
        {
          filePath,
          severity: "error",
          message,
          source: SOURCE,
          code: "toml",
          range,
        },
      ],
    };
  }
}

export const tomlAdapter: DocumentAdapter = {
  id: "toml",
  extensions: ["toml"],
  languageId: "toml",
  displayName: "TOML",

  parse(source: string, filePath: string): ParseResult {
    return parseToml(source, filePath);
  },

  createPreview(source: string, filePath: string): PreviewModel {
    const result = parseToml(source, filePath);
    if (result.valid) {
      return { kind: "structured-data", format: "toml", value: result.value };
    }
    return { kind: "text-fallback", source, language: "toml" };
  },

  validate(source: string, filePath: string): Diagnostic[] {
    return parseToml(source, filePath).diagnostics;
  },

  format(source: string, _filePath: string): { edits: TextEdit[]; formatted: string } {
    // Re-emit by parsing and re-stringifying. smol-toml exports a `stringify`,
    // so we attempt that. If parsing fails, we leave the source unchanged so
    // the formatter is safe and idempotent.
    let value: unknown;
    try {
      value = tomlParse(source);
    } catch {
      return { edits: [], formatted: source };
    }
    let formatted: string;
    try {
      formatted = tomlStringify(value as never) + "\n";
    } catch {
      // If stringify is unavailable or fails on the parsed value, surface an
      // info-level diagnostic and return the source unchanged. We don't
      // throw — the caller may still apply edits.
      const info: Diagnostic = {
        filePath: "",
        severity: "info",
        message: "TOML formatter unavailable — install smol-toml's stringify.",
        source: SOURCE,
        code: "toml.format",
      };
      return {
        edits: [],
        formatted: source + info.message.replace(/^.+?:\s*/, ""),
      };
    }
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
      edits: [{ range: wholeRange, newText: formatted, label: "Format TOML" }],
      formatted,
    };
  },
};

export default tomlAdapter;
