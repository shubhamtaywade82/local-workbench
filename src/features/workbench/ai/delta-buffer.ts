// Coalesces streamed text into one store update per frame. Without it, every
// token re-renders the whole thread, which makes long answers stutter.

export type Scheduler = (run: () => void) => () => void;

/** Runs `run` on the next animation frame, or after 16 ms where frames are unavailable. */
export const frameScheduler: Scheduler = (run) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(() => run());
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(run, 16);
  return () => clearTimeout(id);
};

export class DeltaBuffer {
  private pending = "";
  private cancelScheduled: (() => void) | null = null;

  constructor(
    private readonly write: (text: string) => void,
    private readonly schedule: Scheduler = frameScheduler
  ) {}

  push(text: string): void {
    if (text.length === 0) return;
    this.pending += text;
    if (this.cancelScheduled === null) {
      this.cancelScheduled = this.schedule(() => {
        this.cancelScheduled = null;
        this.flush();
      });
    }
  }

  /** Writes what is buffered now, without waiting for the frame. */
  flush(): void {
    if (this.pending.length === 0) return;
    const text = this.pending;
    this.pending = "";
    this.write(text);
  }

  /** Cancels the scheduled frame and writes whatever remains. */
  dispose(): void {
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.flush();
  }
}
