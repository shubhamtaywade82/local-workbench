import { describe, expect, test } from "bun:test";

import { errorMessage, extractJson, stripCodeFence } from "./text";

describe("stripCodeFence", () => {
  test("removes one outer fence and its language tag", () => {
    expect(stripCodeFence("```json\n{\"a\":1}\n```")).toBe("{\"a\":1}");
  });

  test("keeps nested fences inside the outer one", () => {
    const inner = "# Title\n```ts\nconst a = 1;\n```\nDone";
    expect(stripCodeFence(`\`\`\`markdown\n${inner}\n\`\`\``)).toBe(inner);
  });

  test("returns trimmed text when there is no fence", () => {
    expect(stripCodeFence("  plain  ")).toBe("plain");
  });
});

describe("extractJson", () => {
  test("parses a bare object", () => {
    expect(extractJson<{ a: number }>("{\"a\":1}")).toEqual({ a: 1 });
  });

  test("finds an object inside a fenced block and surrounding prose", () => {
    expect(extractJson<{ label: string }>("Here you go:\n```json\n{\"label\":\"x\"}\n```\nThanks")).toEqual({ label: "x" });
  });

  test("finds the first balanced object, ignoring braces inside strings", () => {
    expect(extractJson<{ t: string }>("prefix {\"t\":\"a } b\"} suffix")).toEqual({ t: "a } b" });
  });

  test("returns undefined when there is no JSON", () => {
    expect(extractJson("no json here")).toBeUndefined();
    expect(extractJson("")).toBeUndefined();
  });
});

describe("errorMessage", () => {
  test("uses the message of an Error and the value of a string", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});
