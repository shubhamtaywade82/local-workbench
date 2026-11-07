import { describe, expect, test } from "bun:test";

import { createSseDecoder } from "./sse";

const asNumber = (value: unknown): number | null => (typeof value === "number" ? value : null);

describe("createSseDecoder", () => {
  test("decodes events that arrive whole", () => {
    const decoder = createSseDecoder(asNumber);
    expect(decoder.push("data: 1\n\ndata: 2\n\n")).toEqual([1, 2]);
  });

  test("joins a frame that is split across chunks", () => {
    const decoder = createSseDecoder(asNumber);
    expect(decoder.push("da")).toEqual([]);
    expect(decoder.push("ta: 4")).toEqual([]);
    expect(decoder.push("2\n")).toEqual([]);
    expect(decoder.push("\n")).toEqual([42]);
  });

  test("accepts CRLF line endings", () => {
    expect(createSseDecoder(asNumber).push("data: 7\r\n\r\n")).toEqual([7]);
  });

  test("delivers a final event that has no trailing blank line on flush", () => {
    const decoder = createSseDecoder(asNumber);
    expect(decoder.push("data: 9")).toEqual([]);
    expect(decoder.flush()).toEqual([9]);
  });

  test("skips malformed JSON and values the parser rejects", () => {
    const decoder = createSseDecoder(asNumber);
    expect(decoder.push("data: {oops\n\ndata: \"text\"\n\ndata: 5\n\n")).toEqual([5]);
  });
});
