// Mermaid document adapter.
// Mermaid has no synchronous offline parser; the real validation happens at
// render time (in the preview UI). Here we do a lightweight pre-check: the
// first non-blank, non-comment line should begin with one of the known diagram
// type keywords. If not, we surface a warning diagnostic; the renderer may
// still show the real Mermaid parse error in the preview pane.

import type {
  Diagnostic,
  DocumentAdapter,
  ParseResult,
  PreviewModel,
} from "@/documents/core/types";

/**
 * Diagram-type keywords Mermaid recognises. Compared case-insensitively against
 * the first non-blank, non-comment token of the file.
 */
const KNOWN_DIAGRAM_TYPES: ReadonlySet<string> = new Set<string>([
  "flowchart",
  "graph",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "statediagram-v2",
  "erdiagram",
  "gantt",
  "pie",
  "journey",
  "gitgraph",
  "mindmap",
  "timeline",
  "quadrantchart",
  "requirementdiagram",
  "c4context",
  "c4dynamic",
]);

interface FirstLine {
  text: string;
  /** 1-based line number. */
  line: number;
}

/** Returns the first non-blank, non-comment line of the source (or null). */
function firstSignificantLine(source: string): FirstLine | null {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    // Mermaid line comments start with `%%`.
    if (trimmed.startsWith("%%")) continue;
    return { text: trimmed, line: i + 1 };
  }
  return null;
}

function computeDiagnostics(source: string, filePath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const first = firstSignificantLine(source);
  if (!first) {
    // Empty file or all-comments — nothing to validate.
    return diagnostics;
  }
  const firstToken = first.text.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!KNOWN_DIAGRAM_TYPES.has(firstToken)) {
    diagnostics.push({
      filePath,
      severity: "warning",
      message: "Unknown diagram type — preview may fail to render.",
      source: "mermaid",
      code: "mermaid/unknown-type",
      range: {
        startLine: first.line,
        startColumn: 1,
        endLine: first.line,
        endColumn: Number.MAX_SAFE_INTEGER,
      },
    });
  }
  return diagnostics;
}

class MermaidAdapter implements DocumentAdapter {
  readonly id = "mermaid";
  readonly extensions = ["mmd", "mermaid"] as const;
  readonly languageId = "mermaid";
  readonly displayName = "Mermaid";

  parse(source: string, filePath: string): ParseResult {
    const diagnostics = computeDiagnostics(source, filePath);
    // We never hard-fail — the renderer will surface real Mermaid errors.
    return { valid: true, value: source, diagnostics };
  }

  createPreview(source: string, _filePath: string): PreviewModel {
    return { kind: "diagram", engine: "mermaid", source };
  }

  validate(source: string, filePath: string): Diagnostic[] {
    return computeDiagnostics(source, filePath);
  }
}

export const mermaidAdapter: DocumentAdapter = new MermaidAdapter();
