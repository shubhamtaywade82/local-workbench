// CSV / TSV document adapter. Parses delimited text according to RFC 4180
// and emits a tabular preview model for interactive spreadsheet display.

import type { DocumentAdapter, ParseResult, PreviewModel } from "@/documents/core/types";

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || (c === "\r" && text[i + 1] === "\n" && i++)) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

export const csvAdapter: DocumentAdapter = {
  id: "csv",
  extensions: ["csv", "tsv", "tab"],
  languageId: "plaintext",
  displayName: "CSV / Tabular",

  parse(source: string): ParseResult {
    const delimiter = source.includes("\t") ? "\t" : ",";
    const rows = parseDelimited(source, delimiter);
    return { valid: true, value: rows, diagnostics: [] };
  },

  createPreview(source: string, filePath: string): PreviewModel {
    const isTsv = filePath.toLowerCase().endsWith(".tsv") || filePath.toLowerCase().endsWith(".tab");
    const allRows = parseDelimited(source, isTsv ? "\t" : ",");
    const headers = allRows.length > 0 ? allRows[0] : [];
    const rows = allRows.length > 1 ? allRows.slice(1) : [];

    return {
      kind: "table",
      format: isTsv ? "tsv" : "csv",
      headers,
      rows,
      source,
    };
  },
};
