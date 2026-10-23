// Append-only log file with size-based rotation. Logging must never throw:
// a full disk or a read-only home directory must not stop the app.

import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_LOG_KEEP = 3;

export class RotatingLog {
  constructor(
    readonly file: string,
    private readonly maxBytes: number = DEFAULT_LOG_MAX_BYTES,
    private readonly keep: number = DEFAULT_LOG_KEEP
  ) {}

  write(line: string): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      if (existsSync(this.file) && statSync(this.file).size >= this.maxBytes) this.rotate();
      appendFileSync(this.file, line.endsWith("\n") ? line : `${line}\n`);
    } catch {
      // Dropped on purpose: see the module comment.
    }
  }

  /** desktop.log -> desktop.log.1 -> ... -> desktop.log.<keep>, the oldest is discarded. */
  private rotate(): void {
    rmSync(`${this.file}.${this.keep}`, { force: true });
    for (let index = this.keep - 1; index >= 1; index--) {
      const from = `${this.file}.${index}`;
      if (existsSync(from)) renameSync(from, `${this.file}.${index + 1}`);
    }
    renameSync(this.file, `${this.file}.1`);
  }
}
