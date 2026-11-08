import { describe, expect, test } from "bun:test";

import { documentRegistry } from "@/documents/core/registry";
import { svgAdapter } from "./svg";

describe("svg document adapter", () => {
  test("claims .svg extension", () => {
    expect(svgAdapter.extensions).toContain("svg");
  });

  test("produces an svg preview model", () => {
    const svg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';
    const preview = svgAdapter.createPreview(svg, "icon.svg");
    expect(preview).toEqual({ kind: "svg", source: svg });
  });

  test("validates svg markup presence", () => {
    expect(svgAdapter.parse("<svg></svg>", "icon.svg").valid).toBe(true);
    expect(svgAdapter.parse("not an svg", "icon.svg").valid).toBe(false);
  });
});

describe("document registry SVG resolution", () => {
  documentRegistry.register(svgAdapter);

  test("resolves .svg files to the svg adapter", () => {
    expect(documentRegistry.resolve("diagram.svg").id).toBe("svg");
  });
});
