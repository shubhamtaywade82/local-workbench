// In-memory document session. Tracks the saved vs draft text and a monotonic
// revision number used to discard stale parser/AI results.

export interface DocumentSession {
  path: string;
  savedText: string;
  draftText: string;
  /** Monotonic revision counter, incremented on every draft change. */
  revision: number;
  /** Revision at the last successful save. */
  savedRevision: number;
  isDirty: boolean;
  /** Optional external version token (e.g. last-known file mtime). */
  diskVersion?: number;
  openedAt: number;
}

export function createSession(path: string, savedText: string): DocumentSession {
  return {
    path,
    savedText,
    draftText: savedText,
    revision: 1,
    savedRevision: 1,
    isDirty: false,
    openedAt: Date.now(),
  };
}

export interface PendingParseResult {
  revision: number;
  /** Promise resolves with the result of parsing at that revision. */
  result: Promise<unknown>;
}
