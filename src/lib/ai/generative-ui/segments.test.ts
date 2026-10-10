/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { hasUiSegment, splitMessageSegments } from "./segments";

describe("splitMessageSegments", () => {
  test("plain text yields a single text segment", () => {
    expect(splitMessageSegments("Hello\nworld")).toEqual([{ kind: "text", text: "Hello\nworld" }]);
  });

  test("empty content yields no segments", () => {
    expect(splitMessageSegments("")).toEqual([]);
    expect(splitMessageSegments("\n\n  \n")).toEqual([]);
  });

  test("splits text / ui / text around an openui-lang fence", () => {
    const content = [
      "Here is the summary:",
      "",
      "```openui-lang",
      'root = Stack([t])',
      't = Text("hi")',
      "```",
      "",
      "Done.",
    ].join("\n");
    expect(splitMessageSegments(content)).toEqual([
      { kind: "text", text: "Here is the summary:" },
      { kind: "ui", code: 'root = Stack([t])\nt = Text("hi")', complete: true },
      { kind: "text", text: "Done." },
    ]);
  });

  test("other-language fences stay text, including their contents", () => {
    const content = ["Example:", "```json", '{ "a": 1 }', "```", "End"].join("\n");
    const segments = splitMessageSegments(content);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ kind: "text", text: content });
    expect(hasUiSegment(content)).toBe(false);
  });

  test("an openui-lang marker inside another fence is not treated as UI", () => {
    const content = ["````markdown", "```openui-lang", "root = Stack([])", "```", "````"].join("\n");
    expect(hasUiSegment(content)).toBe(false);
  });

  test("tilde fences are honoured for non-UI code", () => {
    const content = ["~~~yaml", "a: 1", "~~~", "```openui-lang", "root = Stack([])", "```"].join("\n");
    const segments = splitMessageSegments(content);
    expect(segments.map((s) => s.kind)).toEqual(["text", "ui"]);
  });

  test("the `openui` tag alias and case are accepted", () => {
    expect(hasUiSegment("```OpenUI\nroot = Stack([])\n```")).toBe(true);
  });

  test("unterminated UI fence is reported incomplete", () => {
    const segments = splitMessageSegments("Intro\n```openui-lang\nroot = Stack([a])\na = Te", { streaming: true });
    expect(segments).toEqual([
      { kind: "text", text: "Intro" },
      { kind: "ui", code: "root = Stack([a])\na = Te", complete: false },
    ]);
  });

  test("while streaming, a half-typed fence opener is held back", () => {
    expect(splitMessageSegments("Intro\n```openui-l", { streaming: true })).toEqual([
      { kind: "text", text: "Intro" },
    ]);
    expect(splitMessageSegments("Intro\n``", { streaming: true })).toEqual([{ kind: "text", text: "Intro" }]);
  });

  test("when not streaming, a trailing backtick line is kept as text", () => {
    expect(splitMessageSegments("Intro\n```openui-l")).toEqual([{ kind: "text", text: "Intro\n```openui-l" }]);
  });

  test("multiple UI blocks are returned in order", () => {
    const content = "```openui-lang\nroot = Stack([])\n```\nmid\n```openui-lang\nroot = Stack([x])\n```";
    const kinds = splitMessageSegments(content).map((s) => s.kind);
    expect(kinds).toEqual(["ui", "text", "ui"]);
  });

  test("indented closing fence closes the UI block", () => {
    const segments = splitMessageSegments("```openui-lang\nroot = Stack([])\n   ```\nafter");
    expect(segments).toEqual([
      { kind: "ui", code: "root = Stack([])", complete: true },
      { kind: "text", text: "after" },
    ]);
  });
});
