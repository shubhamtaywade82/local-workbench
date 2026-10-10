// XML document adapter, backed by `fast-xml-parser`.
// Parse: validate via XMLValidator first, then build a JS object with XMLParser.
// Preview: emit an `xml-tree` model so the UI can render a tree view.
// Format: pretty-print via XMLBuilder with 2-space indent.

import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  Diagnostic,
  DocumentAdapter,
  ParseResult,
  PreviewModel,
  TextEdit,
} from "@/documents/core/types";

/** Builds an optional SourceRange from the (1-based) line/col the validator reports. */
function rangeFromLineCol(line?: number, col?: number): Diagnostic["range"] {
  if (!line || !col) return undefined;
  return {
    startLine: line,
    startColumn: col,
    endLine: line,
    endColumn: Number.MAX_SAFE_INTEGER,
  };
}

class XmlAdapter implements DocumentAdapter {
  readonly id = "xml";
  readonly extensions = ["xml", "xsd", "svg", "xsl", "rss", "atom"] as const;
  readonly languageId = "xml";
  readonly displayName = "XML";

  parse(source: string, filePath: string): ParseResult {
    if (source.trim() === "") {
      // Empty document — treat as valid empty value.
      return { valid: true, value: undefined, diagnostics: [] };
    }

    // Step 1: structural validation.
    const validation = XMLValidator.validate(source);
    if (validation !== true) {
      const err = validation.err;
      const diag: Diagnostic = {
        filePath,
        severity: "error",
        message: err.msg,
        source: "xml",
        code: err.code,
        range: rangeFromLineCol(err.line, err.col),
      };
      return { valid: false, diagnostics: [diag] };
    }

    // Step 2: build JS object. Attributes appear as `@_attrName` keys.
    const parser = new XMLParser({
      ignoreAttributes: false,
      preserveOrder: false,
    });
    let parsed: unknown;
    try {
      parsed = parser.parse(source);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        valid: false,
        diagnostics: [
          {
            filePath,
            severity: "error",
            message,
            source: "xml",
            code: "xml/parse",
          },
        ],
      };
    }
    return { valid: true, value: parsed, diagnostics: [] };
  }

  createPreview(source: string, filePath: string): PreviewModel {
    const result = this.parse(source, filePath);
    if (result.valid) {
      return { kind: "xml-tree", source, value: result.value };
    }
    // On parse failure, still surface the source so the tree view can fall back.
    return { kind: "xml-tree", source, value: undefined };
  }

  validate(source: string, filePath: string): Diagnostic[] {
    return this.parse(source, filePath).diagnostics;
  }

  format(source: string, filePath: string): { edits: TextEdit[]; formatted: string } {
    const result = this.parse(source, filePath);
    if (!result.valid) {
      // Don't attempt to reformat invalid XML — return as-is.
      return { edits: [], formatted: source };
    }
    const builder = new XMLBuilder({
      format: true,
      indentBy: "  ",
      ignoreAttributes: false,
    });
    let formatted: string;
    try {
      formatted = builder.build(result.value);
    } catch {
      return { edits: [], formatted: source };
    }
    if (formatted === source) {
      return { edits: [], formatted };
    }
    const edit: TextEdit = {
      range: {
        startLine: 1,
        startColumn: 1,
        endLine: Number.MAX_SAFE_INTEGER,
        endColumn: Number.MAX_SAFE_INTEGER,
      },
      newText: formatted,
      label: "Format XML",
    };
    return { edits: [edit], formatted };
  }
}

export const xmlAdapter: DocumentAdapter = new XmlAdapter();
