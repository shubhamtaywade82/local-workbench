// Document adapter core types.
// These contracts are versioned and intentionally framework-agnostic so they can be
// tested without a browser, used by web workers, and reused by the AI / diagnostics
// subsystems.

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface SourceRange {
  /** 1-based line number, matching Monaco's marker convention. */
  startLine: number;
  /** 1-based column. */
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Diagnostic {
  filePath: string;
  severity: DiagnosticSeverity;
  message: string;
  /** Origin rule set or parser name. */
  source: string;
  code?: string;
  range?: SourceRange;
  /** Optional deterministic quick-fix edit set. */
  fixes?: TextEdit[];
}

export interface TextEdit {
  range: SourceRange;
  newText: string;
  /** Optional label for the quick-fix menu. */
  label?: string;
}

export interface CompletionContext {
  filePath: string;
  languageId: string;
  /** 1-based. */
  lineNumber: number;
  column: number;
  word?: string;
  triggerKind?: "invoked" | "auto" | "triggerCharacter";
  triggerCharacter?: string;
}

export interface CompletionItem {
  label: string;
  insertText: string;
  detail?: string;
  kind?: "keyword" | "value" | "snippet" | "property" | "function" | "text";
}

export type PreviewModel =
  | { kind: "markdown"; source: string }
  | { kind: "structured-data"; format: string; value: unknown }
  | { kind: "diagram"; engine: "mermaid"; source: string }
  | { kind: "xml-tree"; source: string; value: unknown }
  | { kind: "sandboxed-html"; source: string }
  | { kind: "text-fallback"; source: string; language: string };

export interface ParseSuccess {
  valid: true;
  value: unknown;
  diagnostics: Diagnostic[];
}

export interface ParseFailure {
  valid: false;
  diagnostics: Diagnostic[];
  /** Optional partial value when error recovery is possible. */
  partial?: unknown;
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface DocumentAdapter {
  /** Stable identifier, e.g. "markdown", "json", "yaml". */
  id: string;
  /** File extensions this adapter handles, lower-case without the dot. */
  extensions: readonly string[];
  /** Monaco language id for syntax highlighting. */
  languageId: string;
  /** Human-friendly display name shown in the UI. */
  displayName: string;

  parse(source: string, filePath: string): ParseResult;
  createPreview(source: string, filePath: string): PreviewModel;

  validate?(source: string, filePath: string): Diagnostic[];
  format?(source: string, filePath: string): { edits: TextEdit[]; formatted: string };
  getCompletions?(context: CompletionContext): CompletionItem[];
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  /** Children for directories — populated lazily. */
  children?: WorkspaceFileEntry[];
}

export interface Workspace {
  name: string;
  rootPath: string;
  /** Origin of the workspace — affects what operations are allowed. */
  source: "file-system-access" | "in-memory" | "indexeddb" | "server" | "electron";
  createdAt: number;
  /** For `source: "server"`: the opaque root id from GET /api/fs/roots. */
  serverRootId?: string;
  /**
   * For `source: "electron"`: stable id derived from the folder's canonical
   * path. Keeps recovery drafts separate for folders that share a basename.
   */
  rootId?: string;
}
