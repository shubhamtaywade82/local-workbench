import { describe, expect, test } from "bun:test";

import { diffStats, proposalDiff, proposalFreshness } from "./proposal";

describe("proposalFreshness", () => {
  test("is current while the document still has the text the model saw", () => {
    expect(proposalFreshness({ baseText: "a" }, "a")).toBe("current");
  });

  test("is stale once the user has edited the document", () => {
    expect(proposalFreshness({ baseText: "a" }, "a!")).toBe("stale");
  });

  test("is missing when the document is no longer open", () => {
    expect(proposalFreshness({ baseText: "a" }, null)).toBe("missing");
  });
});

describe("proposalDiff and diffStats", () => {
  test("counts the lines that changed", () => {
    const patch = proposalDiff({ baseText: "one\ntwo\n", newText: "one\n2\nthree\n" }, "a.md");
    expect(diffStats(patch)).toEqual({ added: 2, removed: 1 });
  });

  test("reports no change for identical text", () => {
    const patch = proposalDiff({ baseText: "same\n", newText: "same\n" }, "a.md");
    expect(diffStats(patch)).toEqual({ added: 0, removed: 0 });
  });
});
