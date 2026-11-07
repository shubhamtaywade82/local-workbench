import { describe, expect, test } from "bun:test";

import { DeltaBuffer, type Scheduler } from "./delta-buffer";

/** A scheduler the test controls: nothing runs until `tick` is called. */
function manualScheduler(): { schedule: Scheduler; tick: () => void; cancelled: () => number } {
  let queued: (() => void) | null = null;
  let cancels = 0;
  return {
    schedule: (run) => {
      queued = run;
      return () => {
        cancels += 1;
        queued = null;
      };
    },
    tick: () => {
      const run = queued;
      queued = null;
      run?.();
    },
    cancelled: () => cancels,
  };
}

describe("DeltaBuffer", () => {
  test("coalesces many pushes into one write per frame", () => {
    const writes: string[] = [];
    const frame = manualScheduler();
    const buffer = new DeltaBuffer((text) => writes.push(text), frame.schedule);
    buffer.push("Hel");
    buffer.push("lo");
    buffer.push(" world");
    expect(writes).toEqual([]);
    frame.tick();
    expect(writes).toEqual(["Hello world"]);
  });

  test("dispose writes what remains and cancels the pending frame", () => {
    const writes: string[] = [];
    const frame = manualScheduler();
    const buffer = new DeltaBuffer((text) => writes.push(text), frame.schedule);
    buffer.push("tail");
    buffer.dispose();
    expect(writes).toEqual(["tail"]);
    expect(frame.cancelled()).toBe(1);
  });

  test("ignores empty pushes", () => {
    const writes: string[] = [];
    const buffer = new DeltaBuffer((text) => writes.push(text), manualScheduler().schedule);
    buffer.push("");
    buffer.dispose();
    expect(writes).toEqual([]);
  });
});
