import { describe, expect, test } from "bun:test";

import { documentRegistry } from "@/documents/core/registry";
import { htmlAdapter } from "./html";

describe("html document adapter", () => {
  test("claims .html and .htm extensions", () => {
    expect(htmlAdapter.extensions).toContain("html");
    expect(htmlAdapter.extensions).toContain("htm");
  });

  test("produces a sandboxed-html preview model", () => {
    const html = "<!DOCTYPE html><html><body><h1>Architecture</h1></body></html>";
    const preview = htmlAdapter.createPreview(html, "rendered/01-architecture.html");
    expect(preview).toEqual({ kind: "sandboxed-html", source: html });
  });

  test("parses HTML permissively without errors", () => {
    const result = htmlAdapter.parse("<div>Content</div>", "doc.html");
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("document registry HTML resolution", () => {
  documentRegistry.register(htmlAdapter);

  test("resolves .html and .htm files to the html adapter", () => {
    expect(documentRegistry.resolve("01-architecture.html").id).toBe("html");
    expect(documentRegistry.resolve("index.htm").id).toBe("html");
  });
});
