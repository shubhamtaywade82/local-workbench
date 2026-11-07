import { describe, expect, test } from "bun:test";

import { AcquireAbortedError, QueueFullError, Semaphore } from "./concurrency";

describe("Semaphore", () => {
  test("admits up to maxActive holders and hands freed slots to the queue in order", async () => {
    const semaphore = new Semaphore(1, 2);
    const order: string[] = [];
    const first = await semaphore.acquire();
    const second = semaphore.acquire().then((release) => {
      order.push("second");
      return release;
    });
    const third = semaphore.acquire().then((release) => {
      order.push("third");
      return release;
    });
    expect(semaphore.queuedCount).toBe(2);
    first();
    (await second)();
    (await third)();
    expect(order).toEqual(["second", "third"]);
    expect(semaphore.activeCount).toBe(0);
  });

  test("refuses new work once the queue is full", async () => {
    const semaphore = new Semaphore(1, 0);
    const release = await semaphore.acquire();
    await expect(semaphore.acquire()).rejects.toBeInstanceOf(QueueFullError);
    release();
  });

  test("removes an abandoned waiter so it never takes a slot", async () => {
    const semaphore = new Semaphore(1, 1);
    const holder = await semaphore.acquire();
    const controller = new AbortController();
    const waiting = semaphore.acquire(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(AcquireAbortedError);
    expect(semaphore.queuedCount).toBe(0);
    holder();
    expect(semaphore.activeCount).toBe(0);
  });

  test("release functions are idempotent", async () => {
    const semaphore = new Semaphore(2, 0);
    const release = await semaphore.acquire();
    await semaphore.acquire();
    release();
    release();
    expect(semaphore.activeCount).toBe(1);
  });

  test("rejects invalid limits", () => {
    expect(() => new Semaphore(0, 0)).toThrow(RangeError);
    expect(() => new Semaphore(1, -1)).toThrow(RangeError);
  });
});
