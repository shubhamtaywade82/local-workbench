// Bounded concurrency for Archify renders. Each render spawns a Node process
// that can take a CPU core for seconds, so the server runs a few at a time and
// queues a few more. Anything beyond that is refused at once with `busy`.

export class QueueFullError extends Error {
  constructor(maxQueued: number) {
    super(`Archify render queue is full (${maxQueued} waiting).`);
    this.name = "QueueFullError";
  }
}

export class AcquireAbortedError extends Error {
  constructor() {
    super("Archify render was abandoned before it started.");
    this.name = "AcquireAbortedError";
  }
}

interface Waiter {
  grant(): void;
  abort(): void;
  readonly signal: AbortSignal | undefined;
}

export class Semaphore {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxQueued: number
  ) {
    if (!Number.isInteger(maxActive) || maxActive < 1) {
      throw new RangeError("maxActive must be a positive integer.");
    }
    if (!Number.isInteger(maxQueued) || maxQueued < 0) {
      throw new RangeError("maxQueued must be a non-negative integer.");
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  /**
   * Resolves with a release function once a slot is free. Rejects with
   * QueueFullError when the queue is at capacity, or AcquireAbortedError when
   * the caller gives up while waiting. Each release function is idempotent.
   */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new AcquireAbortedError());
    if (this.active < this.maxActive) {
      this.active += 1;
      return Promise.resolve(this.releaser());
    }
    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(new QueueFullError(this.maxQueued));
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        grant: () => {
          signal?.removeEventListener("abort", waiter.abort);
          resolve(this.releaser());
        },
        abort: () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new AcquireAbortedError());
        },
      };
      this.queue.push(waiter);
      signal?.addEventListener("abort", waiter.abort, { once: true });
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.queue.shift();
      if (next) {
        // Hand the slot straight to the next waiter so a releasing caller cannot starve it.
        this.active += 1;
        next.grant();
      }
    };
  }
}
