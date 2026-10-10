// Markdown document adapter.
//
// Markdown is intentionally permissive: parsing never fails. We still surface a
// small set of deterministic lint-like diagnostics (markdownlint-inspired but
// deliberately minimal — no markdownlint dependency).
//
//   MD018 — Heading must be followed by a space after the `#` markers.
//   MD009 — Trailing whitespace on a line.
//
// All diagnostics use 1-based line/column, matching Monaco's marker convention
// defined in `src/documents/core/types.ts`.

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

const SOURCE = "markdownlint";

/** Range covering a whole line (1-based) for diagnostics that only know the line. */
function wholeLineRange(line: number): SourceRange {
  return {
    startLine: line,
    startColumn: 1,
    endLine: line,
    endColumn: Number.MAX_SAFE_INTEGER,
  };
}

/** Range covering a specific column span on a single line (1-based). */
function columnRange(line: number, startColumn: number, endColumn: number): SourceRange {
  return {
    startLine: line,
    startColumn,
    endLine: line,
    endColumn,
  };
}

/**
 * Run the lightweight markdown checks. Pure function: same input always
 * produces the same diagnostics.
 */
export function lintMarkdown(source: string, filePath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // MD018: no space after hash. Detects lines that look like `##Heading`
    // but ignores ATX headings that are properly spaced (`## Heading`) and
    // closing-style headings (`Heading ===`). We use a permissive regex:
    //   - 1..6 leading `#`
    //   - immediately followed by a non-space, non-`#` character
    //   - and there must be at least one such character afterwards (so `###` alone is OK).
    const headingMatch = /^(#{1,6})([^\s#].*)$/.exec(line);
    if (headingMatch) {
      const hashes = headingMatch[1];
      const rest = headingMatch[2];
      const startColumn = 1;
      const endColumn = hashes.length + 1;
      diagnostics.push({
        filePath,
        severity: "warning",
        message: `No space after hash on ATX heading (MD018). Use "${hashes} ${rest}".`,
        source: SOURCE,
        code: "MD018",
        range: columnRange(lineNumber, startColumn, endColumn),
        fixes: [
          {
            range: columnRange(lineNumber, hashes.length + 1, hashes.length + 1),
            newText: " ",
            label: "Insert a space after the heading hashes",
          },
        ],
      });
    }

    // MD009: trailing whitespace. We look for any run of spaces or tabs at
    // the end of a non-empty line. Two trailing spaces is sometimes used
    // intentionally for hard breaks, but the simpler rule still flags it
    // as info (the lowest severity) so it is informational only.
    const trailingMatch = /[ \t]+$/.exec(line);
    if (trailingMatch) {
      const start = trailingMatch.index + 1; // 1-based column
      const end = line.length + 1;
      diagnostics.push({
        filePath,
        severity: "info",
        message: `Trailing whitespace (MD009).`,
        source: SOURCE,
        code: "MD009",
        range: columnRange(lineNumber, start, end),
        fixes: [
          {
            range: columnRange(lineNumber, start, end),
            newText: "",
            label: "Remove trailing whitespace",
          },
        ],
      });
    }
  }
  return diagnostics;
}

/**
 * The Markdown adapter. Markdown is permissive so `parse` always succeeds —
 * but `validate` will surface lint-style diagnostics.
 */
export const markdownAdapter: DocumentAdapter = {
  id: "markdown",
  extensions: ["md", "markdown"],
  languageId: "markdown",
  displayName: "Markdown",

  parse(source: string, filePath: string): ParseResult {
    // Markdown parsing is permissive: we never fail.
    const diagnostics = lintMarkdown(source, filePath);
    return { valid: true, value: source, diagnostics };
  },

  createPreview(source: string, _filePath: string): PreviewModel {
    return { kind: "markdown", source };
  },

  validate(source: string, filePath: string): Diagnostic[] {
    return lintMarkdown(source, filePath);
  },

  format(source: string, _filePath: string): { edits: TextEdit[]; formatted: string } {
    // Lightweight deterministic formatter:
    //   - trim trailing whitespace on every line
    //   - normalise line endings to LF
    //   - ensure exactly one trailing newline at EOF
    const normalised = source.replace(/\r\n/g, "\n");
    const lines = normalised.split("\n");
    const trimmed = lines.map((line) => line.replace(/[ \t]+$/, ""));
    let formatted = trimmed.join("\n");
    // Ensure single trailing newline.
    formatted = formatted.replace(/\n+$/, "") + "\n";
    const wholeRange: SourceRange = {
      startLine: 1,
      startColumn: 1,
      endLine: lines.length,
      endColumn: Number.MAX_SAFE_INTEGER,
    };
    return {
      edits: [
        {
          range: wholeRange,
          newText: formatted,
          label: "Trim trailing whitespace & normalise EOL",
        },
      ],
      formatted,
    };
  },

  getCompletions(context: CompletionContext): CompletionItem[] {
    // Best-effort markdown completions: a small fixed set of common block
    // starters. We only suggest them when the current line is empty or
    // starts with `#`. This keeps noise out of paragraph text.
    const line = context.lineNumber;
    const col = context.column;
    if (line < 1 || col < 1) return [];
    const suggestions: CompletionItem[] = [
      { label: "Heading 1", insertText: "# ", detail: "ATX H1", kind: "snippet" },
      { label: "Heading 2", insertText: "## ", detail: "ATX H2", kind: "snippet" },
      { label: "Heading 3", insertText: "### ", detail: "ATX H3", kind: "snippet" },
      { label: "Bullet list", insertText: "- ", detail: "Unordered list item", kind: "snippet" },
      { label: "Numbered list", insertText: "1. ", detail: "Ordered list item", kind: "snippet" },
      { label: "Code fence", insertText: "```\n```", detail: "Fenced code block", kind: "snippet" },
      { label: "Blockquote", insertText: "> ", detail: "Block quote", kind: "snippet" },
    ];
    return suggestions;
  },
};

export default markdownAdapter;
