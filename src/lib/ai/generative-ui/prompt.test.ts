/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test";
import { createParser } from "@openuidev/lang-core";
import { COMPONENT_NAMES, GENERATIVE_UI_EXAMPLES } from "./components";
import { getGenerativeUiPrompt, getServerLibrary, isGenerativeUiEnabled } from "./prompt";
import { splitMessageSegments } from "./segments";

const parser = () => createParser(getServerLibrary().toJSONSchema(), "Stack");

type Node = { typeName: string; props: Record<string, unknown> } | null;

describe("isGenerativeUiEnabled", () => {
  const original = process.env.AI_GENERATIVE_UI;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_GENERATIVE_UI;
    else process.env.AI_GENERATIVE_UI = original;
  });

  test.each([
    ["1", true],
    ["true", true],
    [" TRUE ", true],
    ["0", false],
    ["yes", false],
    ["", false],
  ])("AI_GENERATIVE_UI=%p -> %p", (value, expected) => {
    process.env.AI_GENERATIVE_UI = value;
    expect(isGenerativeUiEnabled()).toBe(expected);
  });

  test("unset -> false", () => {
    delete process.env.AI_GENERATIVE_UI;
    expect(isGenerativeUiEnabled()).toBe(false);
  });
});

describe("generative UI prompt", () => {
  const prompt = getGenerativeUiPrompt();

  test("declares every component in the contract", () => {
    for (const name of COMPONENT_NAMES) expect(prompt).toContain(`${name}(`);
  });

  test("is in inline mode and carries the workbench rules last", () => {
    expect(prompt).toContain("Inline Mode");
    expect(prompt.lastIndexOf("ProposedEdit ONLY")).toBeGreaterThan(prompt.indexOf("Inline Mode"));
  });

  test("ProposedEdit signature lists required props before optional ones", () => {
    expect(prompt).toContain("ProposedEdit(label: string, newText: string, description?: string)");
  });

  test("stays within a small-context budget (~2k tokens)", () => {
    expect(prompt.length / 4).toBeLessThan(2000);
  });
});

describe("parser against the contract", () => {
  test("bundled examples parse without errors", () => {
    for (const example of GENERATIVE_UI_EXAMPLES) {
      const [segment] = splitMessageSegments(example);
      expect(segment.kind).toBe("ui");
      const result = parser().parse(segment.kind === "ui" ? segment.code : "");
      expect(result.root?.typeName).toBe("Stack");
      expect(result.meta.errors).toEqual([]);
      expect(result.meta.unresolved).toEqual([]);
    }
  });

  test("positional ProposedEdit args bind newText, not description", () => {
    const result = parser().parse('root = Stack([e])\ne = ProposedEdit("Fix comma", "{\\"a\\": 1}")');
    const edit = (result.root?.props.children as Node[])[0];
    expect(edit?.typeName).toBe("ProposedEdit");
    expect(edit?.props.newText).toBe('{"a": 1}');
    expect(edit?.props.description).toBeUndefined();
  });

  test("unknown components are dropped and reported, valid siblings survive", () => {
    const result = parser().parse('root = Stack([a, b])\na = Text("ok")\nb = Chart("x")');
    const children = (result.root?.props.children as Node[]).filter(Boolean);
    expect(children.map((c) => c?.typeName)).toEqual(["Text"]);
    expect(result.meta.errors.length).toBeGreaterThan(0);
  });

  test("missing required props redact the component", () => {
    const result = parser().parse("root = Stack([c])\nc = Callout()");
    const children = (result.root?.props.children as Node[]).filter(Boolean);
    expect(children).toEqual([]);
    expect(result.meta.errors.length).toBeGreaterThan(0);
  });

  test("truncated stream is flagged incomplete but keeps the parsed prefix", () => {
    const result = parser().parse('root = Stack([a, b])\na = Text("first")\nb = Text("sec');
    expect(result.meta.incomplete).toBe(true);
    expect(result.root?.typeName).toBe("Stack");
  });

  test("prose that is not openui-lang produces no root", () => {
    const result = parser().parse("The document defines three services and a network.");
    expect(result.root).toBeNull();
  });
});
