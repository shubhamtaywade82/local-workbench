import { describe, expect, test } from "bun:test";

import { documentRegistry } from "@/documents/core/registry";
import { csvAdapter, parseDelimited } from "./csv";

describe("csv document adapter", () => {
  test("claims .csv, .tsv, and .tab extensions", () => {
    expect(csvAdapter.extensions).toContain("csv");
    expect(csvAdapter.extensions).toContain("tsv");
    expect(csvAdapter.extensions).toContain("tab");
  });

  test("parses RFC 4180 quotes, commas, and escaped quotes", () => {
    const csv = 'col1,col2\n"hello, world","quote ""here"""';
    const rows = parseDelimited(csv, ",");
    expect(rows).toEqual([
      ["col1", "col2"],
      ["hello, world", 'quote "here"'],
    ]);
  });

  test("produces a table preview model with headers and rows", () => {
    const csv = "name,role\nAlice,Admin\nBob,User";
    const preview = csvAdapter.createPreview(csv, "users.csv");
    expect(preview).toEqual({
      kind: "table",
      format: "csv",
      headers: ["name", "role"],
      rows: [
        ["Alice", "Admin"],
        ["Bob", "User"],
      ],
      source: csv,
    });
  });

  test("handles TSV files with tab delimiter", () => {
    const tsv = "id\tval\n1\talpha";
    const preview = csvAdapter.createPreview(tsv, "data.tsv");
    expect(preview).toEqual({
      kind: "table",
      format: "tsv",
      headers: ["id", "val"],
      rows: [["1", "alpha"]],
      source: tsv,
    });
  });
});

describe("document registry CSV resolution", () => {
  documentRegistry.register(csvAdapter);

  test("resolves .csv and .tsv files to the csv adapter", () => {
    expect(documentRegistry.resolve("metrics.csv").id).toBe("csv");
    expect(documentRegistry.resolve("export.tsv").id).toBe("csv");
  });
});
