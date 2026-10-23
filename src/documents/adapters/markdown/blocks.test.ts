/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { applyBlockEdit, parseMarkdownBlocks, type MarkdownBlock } from "./blocks";

const SAMPLE = [
  "# Title",
  "",
  "First paragraph with *emphasis*.",
  "",
  "- one",
  "- two",
  "",
  "```ts",
  "const a = 1;",
  "",
  "const b = 2;",
  "```",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "> quoted",
].join("\n");

function expectBlocksToMatchSource(doc: string, blocks: MarkdownBlock[]) {
  let previousEnd = 0;
  for (const block of blocks) {
    expect(block.source).toBe(doc.slice(block.start, block.end));
    expect(block.start).toBeGreaterThanOrEqual(previousEnd);
    previousEnd = block.end;
  }
}

describe("parseMarkdownBlocks", () => {
  test("returns no blocks for an empty document", () => {
    expect(parseMarkdownBlocks("")).toEqual([]);
  });

  test("returns one block per top-level construct, in source order", () => {
    const blocks = parseMarkdownBlocks(SAMPLE);
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "code",
      "table",
      "blockquote",
    ]);
    expectBlocksToMatchSource(SAMPLE, blocks);
  });

  test("keeps a fenced code block with blank lines inside it as one block", () => {
    const blocks = parseMarkdownBlocks(SAMPLE);
    const code = blocks.find((b) => b.kind === "code");
    expect(code?.source).toBe("```ts\nconst a = 1;\n\nconst b = 2;\n```");
  });

  test("keeps a GFM table as one block", () => {
    const table = parseMarkdownBlocks(SAMPLE).find((b) => b.kind === "table");
    expect(table?.source).toBe("| a | b |\n| - | - |\n| 1 | 2 |");
  });

  test("never includes the blank lines between blocks", () => {
    for (const block of parseMarkdownBlocks(SAMPLE)) {
      expect(block.source.startsWith("\n")).toBe(false);
      expect(block.source.endsWith("\n")).toBe(false);
    }
  });

  test("handles CRLF documents with exact offsets", () => {
    const doc = "# Title\r\n\r\nBody text\r\nmore\r\n\r\n- item";
    const blocks = parseMarkdownBlocks(doc);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list"]);
    expectBlocksToMatchSource(doc, blocks);
  });

  test("uses string indexes correctly with multi-byte characters", () => {
    const doc = "# Café 🚀\n\n日本語の段落。\n\n- 項目";
    const blocks = parseMarkdownBlocks(doc);
    expect(blocks.map((b) => b.source)).toEqual(["# Café 🚀", "日本語の段落。", "- 項目"]);
    expectBlocksToMatchSource(doc, blocks);
  });
});

describe("applyBlockEdit", () => {
  test("replaces only the targeted block", () => {
    const blocks = parseMarkdownBlocks(SAMPLE);
    const paragraph = blocks[1];
    const result = applyBlockEdit(SAMPLE, paragraph, "Rewritten paragraph.");
    expect(result).toEqual({
      ok: true,
      text: SAMPLE.replace("First paragraph with *emphasis*.", "Rewritten paragraph."),
    });
  });

  test("refuses when the draft changed after the block was parsed", () => {
    const blocks = parseMarkdownBlocks(SAMPLE);
    const edited = SAMPLE.replace("# Title", "# Renamed title");
    const result = applyBlockEdit(edited, blocks[0], "# New");
    expect(result).toEqual({ ok: false, reason: "changed" });
  });

  test("drops trailing newlines so the block keeps its boundary", () => {
    const blocks = parseMarkdownBlocks(SAMPLE);
    const result = applyBlockEdit(SAMPLE, blocks[0], "# Next\n\n\n");
    expect(result.ok && result.text.startsWith("# Next\n\nFirst paragraph")).toBe(true);
  });

  test("an empty replacement removes only that block", () => {
    const doc = "one\n\ntwo\n\nthree";
    const blocks = parseMarkdownBlocks(doc);
    const result = applyBlockEdit(doc, blocks[1], "");
    expect(result).toEqual({ ok: true, text: "one\n\n\n\nthree" });
  });

  test("writes replacements with the document's CRLF line endings", () => {
    const doc = "# Title\r\n\r\nBody";
    const blocks = parseMarkdownBlocks(doc);
    const result = applyBlockEdit(doc, blocks[1], "Line one\nLine two");
    expect(result).toEqual({ ok: true, text: "# Title\r\n\r\nLine one\r\nLine two" });
  });

  test("replacing a block with its own text leaves every sample document unchanged", () => {
    const documents = [SAMPLE, "a\n\nb", "# Café 🚀\n\n日本語", "x\r\n\r\ny"];
    for (const doc of documents) {
      for (const block of parseMarkdownBlocks(doc)) {
        const result = applyBlockEdit(doc, block, block.source);
        expect(result).toEqual({ ok: true, text: doc });
      }
    }
  });

  test("edits compose: a re-parsed document accepts the next edit", () => {
    const first = applyBlockEdit(SAMPLE, parseMarkdownBlocks(SAMPLE)[0], "# Renamed");
    if (!first.ok) throw new Error("first edit should apply");
    const blocks = parseMarkdownBlocks(first.text);
    const second = applyBlockEdit(first.text, blocks[1], "Second.");
    expect(second.ok && second.text.startsWith("# Renamed\n\nSecond.\n")).toBe(true);
  });
});
