import { describe, expect, test } from "bun:test";

import { normalizeMermaid, parseArchifyDocument, parseFixOutput, parseReviewOutput } from "./parsers";

describe("parseFixOutput", () => {
  test("accepts the structured JSON proposal", () => {
    expect(parseFixOutput('{"label":"Quote key","description":"Adds quotes.","newText":"{\\"a\\":1}"}')).toEqual({
      structured: true,
      label: "Quote key",
      description: "Adds quotes.",
      newText: '{"a":1}',
    });
  });

  test("accepts a proposal wrapped in a fence", () => {
    const parsed = parseFixOutput('```json\n{"label":"L","newText":"x"}\n```');
    expect(parsed).toMatchObject({ structured: true, label: "L", description: "", newText: "x" });
  });

  test("falls back to the text, flagged unstructured, when there is no JSON", () => {
    expect(parseFixOutput("```\nfixed text\n```")).toEqual({ structured: false, newText: "fixed text" });
  });

  test("rejects a proposal without newText", () => {
    expect(parseFixOutput('{"label":"only a label"}')).toEqual({ structured: false, newText: '{"label":"only a label"}' });
  });
});

describe("parseArchifyDocument", () => {
  test("returns the pretty-printed document when diagram_type matches", () => {
    const parsed = parseArchifyDocument('{"diagram_type":"tree","schema_version":1}', "tree");
    expect(parsed).toEqual({ ok: true, text: '{\n  "diagram_type": "tree",\n  "schema_version": 1\n}\n' });
  });

  test("rejects a mismatched type with the declared value", () => {
    const parsed = parseArchifyDocument('{"diagram_type":"erd"}', "tree");
    expect(parsed).toEqual({ ok: false, message: 'diagram_type must be "tree", but the reply has "erd".' });
  });

  test("rejects a reply that is not one object", () => {
    expect(parseArchifyDocument("[1,2]", "tree")).toEqual({ ok: false, message: "The reply was not one JSON object." });
    expect(parseArchifyDocument("no json", "tree")).toEqual({ ok: false, message: "The reply was not one JSON object." });
  });
});

describe("parseReviewOutput", () => {
  const candidate = {
    title: "Collapse the AI pipeline",
    strength: "Strong",
    files: ["src/lib/ai/server.ts"],
    problem: "Routes repeat parsing.",
    solution: "One task runner.",
    wins: ["leverage: one path"],
    beforeMermaid: "flowchart LR\n A --> B",
    afterMermaid: "flowchart LR\n A --> C",
  };

  test("accepts a valid review", () => {
    const parsed = parseReviewOutput(JSON.stringify({ summary: "Two hot spots.", candidates: [candidate] }));
    expect(parsed).toMatchObject({ ok: true, summary: "Two hot spots." });
    if (parsed.ok) expect(parsed.candidates[0].title).toBe("Collapse the AI pipeline");
  });

  test("rejects an unknown strength and names the field", () => {
    const parsed = parseReviewOutput(JSON.stringify({ summary: "s", candidates: [{ ...candidate, strength: "Maybe" }] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("candidates.0.strength");
  });

  test("rejects more than six candidates and an empty list", () => {
    expect(parseReviewOutput(JSON.stringify({ summary: "s", candidates: [] })).ok).toBe(false);
    const seven = Array.from({ length: 7 }, () => candidate);
    expect(parseReviewOutput(JSON.stringify({ summary: "s", candidates: seven })).ok).toBe(false);
  });
});

describe("normalizeMermaid", () => {
  test("drops prose before the opener", () => {
    expect(normalizeMermaid("Here is the diagram:\nsequenceDiagram\nA->>B: hi", "sequence")).toBe("sequenceDiagram\nA->>B: hi");
  });

  test("keeps a legacy graph keyword for flowcharts", () => {
    expect(normalizeMermaid("graph TD\nA-->B", "flowchart")).toBe("graph TD\nA-->B");
  });

  test("adds a missing opener", () => {
    expect(normalizeMermaid("A --> B", "flowchart")).toBe("flowchart\nA --> B");
    expect(normalizeMermaid("A --> B", "class")).toBe("classDiagram\nA --> B");
  });

  test("strips a code fence", () => {
    expect(normalizeMermaid("```mermaid\nstateDiagram-v2\n[*] --> A\n```", "state")).toBe("stateDiagram-v2\n[*] --> A");
  });
});
