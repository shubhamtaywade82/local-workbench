// TOON (Token-Oriented Object Notation) document adapter.
//
// TOON is a minimal line-oriented, indentation-based data format. This file
// implements a small compatible subset:
//   - `#` starts a line comment.
//   - Blank lines are skipped.
//   - Indentation is two spaces per level; tabs are forbidden (auto-converted
//     with a warning diagnostic).
//   - `key: value` defines a scalar property of the parent object.
//   - `key:` (no value) followed by indented children defines a nested object
//     (when children are `key: value` lines) or an array (when children are
//     `- value` lines).
//   - `- value` defines an array element under the parent key.
//   - Scalars: bare numbers, `true`, `false`, `null`, or bare/quoted strings.
//     Double-quoted strings support JSON-style escapes.
//
// Round-trip: `parseToon(toonStringify(value))` equals `value` for plain data
// (strings, numbers, booleans, null, plain objects, arrays of scalars).
//
// KNOWN LIMITATION: arrays of objects do NOT round-trip in this minimal
// implementation. `toonStringify` will serialize such elements as a JSON
// string (lossy) rather than emit nested object syntax. The parser, in turn,
// does not support `key: value` lines inside an array context.
//
// The exports `parseToon` and `toonStringify` are also surfaced as named
// exports so they can be reused by the AI convert-format action and by
// JSON<->TOON conversion tests.

import type {
  Diagnostic,
  DocumentAdapter,
  ParseResult,
  PreviewModel,
  TextEdit,
} from "@/documents/core/types";

// ---------------------------------------------------------------------------
// Diagnostic helpers
// ---------------------------------------------------------------------------

function diag(
  filePath: string,
  line: number,
  severity: "error" | "warning" | "info" | "hint",
  message: string,
  code: string,
): Diagnostic {
  return {
    filePath,
    severity,
    message,
    source: "toon",
    code,
    range: {
      startLine: line,
      startColumn: 1,
      endLine: line,
      endColumn: Number.MAX_SAFE_INTEGER,
    },
  };
}

// ---------------------------------------------------------------------------
// Scalar parsing
// ---------------------------------------------------------------------------

const RE_INT = /^-?\d+$/;
const RE_FLOAT = /^-?\d+\.\d+$/;
const RE_EXP = /^-?\d+(\.\d+)?[eE][-+]?\d+$/;

/**
 * Parses a TOON scalar from a raw (post-colon or post-dash) string fragment.
 * Emits diagnostics for malformed quoted strings but never throws.
 */
function parseScalar(
  raw: string,
  filePath: string,
  line: number,
  diagnostics: Diagnostic[],
): unknown {
  const s = raw.trim();
  if (s === "") return null;

  if (s.startsWith('"')) {
    if (s.length < 2 || !s.endsWith('"')) {
      diagnostics.push(
        diag(filePath, line, "error", "Unterminated double-quoted string.", "toon/syntax"),
      );
      return s;
    }
    return unescapeString(s.slice(1, -1), filePath, line, diagnostics);
  }

  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;

  if (RE_INT.test(s)) return parseInt(s, 10);
  if (RE_FLOAT.test(s) || RE_EXP.test(s)) return parseFloat(s);

  return s;
}

/**
 * Parses a TOON key fragment (the text before the `:` separator). Supports
 * double-quoted keys with escapes; bare keys must not contain whitespace.
 */
function parseKey(
  raw: string,
  filePath: string,
  line: number,
  diagnostics: Diagnostic[],
): string | null {
  const s = raw.trim();
  if (s === "") return null;

  if (s.startsWith('"')) {
    if (s.length < 2 || !s.endsWith('"')) {
      diagnostics.push(
        diag(filePath, line, "error", "Unterminated double-quoted key.", "toon/syntax"),
      );
      return null;
    }
    return unescapeString(s.slice(1, -1), filePath, line, diagnostics);
  }

  if (/\s/.test(s)) {
    diagnostics.push(
      diag(
        filePath,
        line,
        "warning",
        "Bare key contains whitespace; consider quoting it.",
        "toon/syntax",
      ),
    );
  }
  return s;
}

/**
 * Locates the index of the `:` separator that terminates the key in `content`.
 * For quoted keys, the colon must appear immediately after the closing quote.
 * Returns -1 if no separator is found.
 */
function findColon(content: string): number {
  if (content.startsWith('"')) {
    let i = 1;
    while (i < content.length) {
      if (content[i] === "\\") {
        i += 2;
        continue;
      }
      if (content[i] === '"') break;
      i++;
    }
    if (i >= content.length) return -1;
    // `i` is at the closing quote; colon should be at i+1.
    return i + 1;
  }
  return content.indexOf(":");
}

/**
 * Unescapes a JSON-style escape sequence inside a double-quoted string.
 * Emits a warning for unknown escapes and continues best-effort.
 */
function unescapeString(
  body: string,
  filePath: string,
  line: number,
  diagnostics: Diagnostic[],
): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c !== "\\") {
      out += c;
      i++;
      continue;
    }
    const next = body[i + 1];
    switch (next) {
      case "n": out += "\n"; i += 2; break;
      case "t": out += "\t"; i += 2; break;
      case "r": out += "\r"; i += 2; break;
      case '"': out += '"'; i += 2; break;
      case "\\": out += "\\"; i += 2; break;
      case "/": out += "/"; i += 2; break;
      case "b": out += "\b"; i += 2; break;
      case "f": out += "\f"; i += 2; break;
      case "u": {
        const hex = body.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          diagnostics.push(
            diag(filePath, line, "warning", `Invalid unicode escape \\u${hex}.`, "toon/syntax"),
          );
          out += next;
          i += 2;
        }
        break;
      }
      case undefined:
        out += "\\";
        i += 1;
        break;
      default:
        diagnostics.push(
          diag(filePath, line, "warning", `Unknown escape sequence \\${next}.`, "toon/syntax"),
        );
        out += next;
        i += 2;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface Frame {
  /** Indent of the line that created this frame. -1 for the root. */
  indent: number;
  /**
   * Container this frame represents. For the root, the root object. For a
   * `key:` frame, this is `undefined` until the first child decides whether
   * the value is an object or an array.
   */
  container: unknown;
  /** For `key:` frames, the key under which the container lives in the parent. */
  key?: string;
  /** Whether the container is an array. */
  isArray: boolean;
  /** Parent frame, used to write back the container once decided. */
  parent: Frame | null;
}

export interface ToonParseResult {
  value: unknown;
  diagnostics: Diagnostic[];
}

/**
 * Parses a TOON source string into a plain JS value (object at the root).
 * Emits diagnostics for malformed input but never throws.
 */
export function parseToon(source: string, filePath: string = ""): ToonParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r?\n/);

  const root: Record<string, unknown> = {};
  const rootFrame: Frame = {
    indent: -1,
    container: root,
    isArray: false,
    parent: null,
  };
  const stack: Frame[] = [rootFrame];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;

    // --- Compute indentation, converting tabs to 2 spaces each. ---
    let lead = "";
    let j = 0;
    let hasTab = false;
    while (j < raw.length && (raw[j] === " " || raw[j] === "\t")) {
      if (raw[j] === "\t") {
        hasTab = true;
        lead += "  ";
      } else {
        lead += " ";
      }
      j++;
    }
    if (hasTab) {
      diagnostics.push(
        diag(
          filePath,
          lineNo,
          "warning",
          "Tab indentation is not allowed in TOON; converting to spaces.",
          "toon/tab-indent",
        ),
      );
    }
    const indent = lead.length;
    const content = raw.slice(j);

    // Skip blank lines and comments.
    if (content === "" || content.startsWith("#")) continue;

    // Pop frames whose indent >= current indent.
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    // --- Dispatch on line shape. ---
    if (content === "-" || content.startsWith("- ")) {
      handleArrayElement(content, lineNo, filePath, parent, diagnostics);
      continue;
    }

    // Otherwise: `key: value` or `key:`.
    const colonIdx = findColon(content);
    if (colonIdx < 0) {
      diagnostics.push(
        diag(
          filePath,
          lineNo,
          "error",
          "Invalid TOON line: expected 'key: value', 'key:', or '- value'.",
          "toon/syntax",
        ),
      );
      continue;
    }
    const keyRaw = content.slice(0, colonIdx);
    const restRaw = content.slice(colonIdx + 1);
    const key = parseKey(keyRaw, filePath, lineNo, diagnostics);
    if (key === null) {
      diagnostics.push(
        diag(filePath, lineNo, "error", "Empty key before ':' in TOON line.", "toon/syntax"),
      );
      continue;
    }

    const restTrim = restRaw.trim();
    if (restTrim === "") {
      // `key:` with no inline value — open a new frame for nested children.
      openChildFrame(key, indent, parent, filePath, lineNo, diagnostics, stack);
    } else {
      // `key: value` — scalar assignment into the parent object.
      const value = parseScalar(restTrim, filePath, lineNo, diagnostics);
      assignScalarToParent(key, value, parent, filePath, lineNo, diagnostics);
    }
  }

  return { value: root, diagnostics };
}

/** Handles a `- value` or bare `-` line. */
function handleArrayElement(
  content: string,
  lineNo: number,
  filePath: string,
  parent: Frame,
  diagnostics: Diagnostic[],
): void {
  // Bare `-` → null element; `- value` → parsed scalar.
  const value = content === "-" ? null : parseScalar(content.slice(2), filePath, lineNo, diagnostics);

  if (parent.parent === null) {
    // Top-level array element: no parent key.
    diagnostics.push(
      diag(
        filePath,
        lineNo,
        "error",
        "Array element '-' at top level has no parent key.",
        "toon/syntax",
      ),
    );
    return;
  }

  // First child of a `key:` frame decides its container type as an array.
  if (parent.container === undefined) {
    parent.container = [];
    parent.isArray = true;
    writeBackToGrandparent(parent);
  }

  if (!parent.isArray) {
    diagnostics.push(
      diag(
        filePath,
        lineNo,
        "error",
        `Array element '-' under key '${parent.key ?? ""}' which was opened as object.`,
        "toon/syntax",
      ),
    );
    return;
  }
  (parent.container as unknown[]).push(value);
}

/** Opens a new frame for a `key:` line with no inline value. */
function openChildFrame(
  key: string,
  indent: number,
  parent: Frame,
  filePath: string,
  lineNo: number,
  diagnostics: Diagnostic[],
  stack: Frame[],
): void {
  if (parent.isArray) {
    // `key:` inside an array context — not supported by minimal TOON.
    diagnostics.push(
      diag(
        filePath,
        lineNo,
        "error",
        `Property '${key}:' inside an array context is not supported in minimal TOON.`,
        "toon/syntax",
      ),
    );
    return;
  }

  // Ensure parent's container is decided as an object (if not yet).
  if (parent.container === undefined) {
    parent.container = {};
    parent.isArray = false;
    writeBackToGrandparent(parent);
  }

  // Place a placeholder; finalised when a child writes back to this frame.
  (parent.container as Record<string, unknown>)[key] = null;
  stack.push({
    indent,
    container: undefined,
    isArray: false,
    key,
    parent,
  });
}

/** Assigns a scalar value to a parent object frame, deciding the container as object if needed. */
function assignScalarToParent(
  key: string,
  value: unknown,
  parent: Frame,
  filePath: string,
  lineNo: number,
  diagnostics: Diagnostic[],
): void {
  if (parent.isArray) {
    diagnostics.push(
      diag(
        filePath,
        lineNo,
        "error",
        `Property '${key}:' inside an array context is not supported in minimal TOON.`,
        "toon/syntax",
      ),
    );
    return;
  }
  if (parent.container === undefined) {
    parent.container = {};
    parent.isArray = false;
    writeBackToGrandparent(parent);
  }
  (parent.container as Record<string, unknown>)[key] = value;
}

/** Writes a `key:` frame's newly-decided container back into its grandparent. */
function writeBackToGrandparent(frame: Frame): void {
  const gp = frame.parent;
  if (!gp || frame.key === undefined) return;
  if (gp.isArray) {
    // Should not happen for `key:` frames (parser disallows), but be safe.
    (gp.container as unknown[]).push(frame.container);
    return;
  }
  (gp.container as Record<string, unknown>)[frame.key] = frame.container;
}

// ---------------------------------------------------------------------------
// Stringifier
// ---------------------------------------------------------------------------

/** Returns true if a bare (unquoted) string would parse back ambiguously. */
function needsQuoting(s: string): boolean {
  if (s === "") return true;
  if (s === "true" || s === "false" || s === "null") return true;
  if (RE_INT.test(s) || RE_FLOAT.test(s) || RE_EXP.test(s)) return true;
  if (/^["#]/.test(s)) return true;
  if (/\s/.test(s)) return true;
  if (s.includes(":")) return true;
  if (s.includes("-")) return true;
  return false;
}

/** Quotes a string with JSON-style escapes. */
function quoteString(s: string): string {
  let out = '"';
  for (const c of s) {
    switch (c) {
      case "\n": out += "\\n"; break;
      case "\t": out += "\\t"; break;
      case "\r": out += "\\r"; break;
      case '"': out += '\\"'; break;
      case "\\": out += "\\\\"; break;
      case "\b": out += "\\b"; break;
      case "\f": out += "\\f"; break;
      default: {
        const code = c.charCodeAt(0);
        if (code < 0x20) {
          out += "\\u" + code.toString(16).padStart(4, "0");
        } else {
          out += c;
        }
      }
    }
  }
  out += '"';
  return out;
}

/** Formats a key, quoting only when necessary. */
function formatKey(key: string): string {
  if (needsQuoting(key)) return quoteString(key);
  return key;
}

/** Formats a scalar value for emission. */
function formatScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (needsQuoting(value)) return quoteString(value);
    return value;
  }
  // Unknown — fall back to quoted JSON.
  return quoteString(JSON.stringify(value));
}

/**
 * Serialises a plain JS value to TOON source. Round-trips with `parseToon`
 * for plain data (strings, numbers, booleans, null, plain objects, arrays
 * of scalars). Arrays of objects are serialised lossily as JSON strings.
 */
export function toonStringify(value: unknown): string {
  const lines: string[] = [];
  emitValue(value, null, 0, lines);
  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n") + "\n";
}

function emitValue(
  value: unknown,
  key: string | null,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);

  if (Array.isArray(value)) {
    if (key === null) {
      // Top-level array — not natively representable in TOON; emit as comment.
      lines.push(`# ${JSON.stringify(value)}`);
      return;
    }
    lines.push(`${pad}${formatKey(key)}:`);
    for (const item of value) {
      if (item === null) {
        lines.push(`${pad}  -`);
      } else if (Array.isArray(item) || (typeof item === "object" && item !== null)) {
        // Arrays/objects inside arrays are not natively supported in minimal TOON.
        // Serialise lossily as a JSON string so the output still parses.
        lines.push(`${pad}  - ${quoteString(JSON.stringify(item))}`);
      } else {
        lines.push(`${pad}  - ${formatScalar(item)}`);
      }
    }
    return;
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (key === null) {
      // Top-level object: emit children directly.
      for (const k of Object.keys(obj)) {
        emitValue(obj[k], k, indent, lines);
      }
      return;
    }
    lines.push(`${pad}${formatKey(key)}:`);
    for (const k of Object.keys(obj)) {
      emitValue(obj[k], k, indent + 1, lines);
    }
    return;
  }

  // Scalar.
  if (key === null) {
    // Top-level scalar — not natively representable; emit as comment.
    lines.push(`# ${JSON.stringify(value)}`);
    return;
  }
  lines.push(`${pad}${formatKey(key)}: ${formatScalar(value)}`);
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

class ToonAdapter implements DocumentAdapter {
  readonly id = "toon";
  readonly extensions = ["toon"] as const;
  // Monaco has no built-in toon highlighter; use `plaintext` so Monaco does
  // not error when assigning the language to the model.
  readonly languageId = "plaintext";
  readonly displayName = "TOON";

  parse(source: string, filePath: string): ParseResult {
    const { value, diagnostics } = parseToon(source, filePath);
    const hasError = diagnostics.some((d) => d.severity === "error");
    if (hasError && Object.keys(value as Record<string, unknown>).length === 0) {
      return { valid: false, diagnostics };
    }
    // We recovered some value — surface diagnostics but still return success.
    return { valid: true, value, diagnostics };
  }

  createPreview(source: string, filePath: string): PreviewModel {
    const { value, diagnostics } = parseToon(source, filePath);
    const hasError = diagnostics.some((d) => d.severity === "error");
    if (hasError) {
      return { kind: "text-fallback", source, language: "plaintext" };
    }
    return { kind: "structured-data", format: "toon", value };
  }

  validate(source: string, filePath: string): Diagnostic[] {
    return parseToon(source, filePath).diagnostics;
  }

  format(source: string, filePath: string): { edits: TextEdit[]; formatted: string } {
    const { value } = parseToon(source, filePath);
    const formatted = toonStringify(value);
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
      label: "Format TOON",
    };
    return { edits: [edit], formatted };
  }
}

export const toonAdapter: DocumentAdapter = new ToonAdapter();
