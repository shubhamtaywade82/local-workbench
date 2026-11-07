import { describe, expect, test } from "bun:test";

import { documentRegistry } from "@/documents/core/registry";
import { jsonAdapter } from "@/documents/adapters/json/json";

import { archifyAdapter } from "./archify";

const architecture = '{"schema_version":1,"diagram_type":"architecture","meta":{"title":"T","output":"t.html"},"components":[]}';

describe("archify document adapter", () => {
  test("claims JSON documents that declare an Archify diagram_type", () => {
    expect(archifyAdapter.matchesContent?.(architecture, "flows/web-app.json")).toBe(true);
  });

  test("does not claim JSON without a diagram_type, or other formats", () => {
    expect(archifyAdapter.matchesContent?.('{"name":"x"}', "package.json")).toBe(false);
    expect(archifyAdapter.matchesContent?.(architecture, "notes.md")).toBe(false);
    expect(archifyAdapter.matchesContent?.(architecture, "config.yaml")).toBe(false);
  });

  test("produces an archify preview model carrying the type and path", () => {
    const preview = archifyAdapter.createPreview(architecture, "flows/web-app.json");
    expect(preview).toEqual({ kind: "archify", source: architecture, diagramType: "architecture", filePath: "flows/web-app.json" });
  });

  test("keeps JSON parsing and syntax diagnostics with the JSON adapter", () => {
    const source = '{"diagram_type": "architecture",';
    expect(archifyAdapter.parse(source, "a.json")).toEqual(jsonAdapter.parse(source, "a.json"));
  });
});

describe("document registry content resolution", () => {
  // Bootstrap order matters: the JSON adapter owns the extension, archify claims by content.
  documentRegistry.register(jsonAdapter);
  documentRegistry.register(archifyAdapter);

  test("resolves an Archify document to the archify adapter", () => {
    expect(documentRegistry.resolveForContent("diagrams/web-app.json", architecture).id).toBe("archify");
  });

  test("keeps ordinary JSON on the JSON adapter", () => {
    expect(documentRegistry.resolveForContent("package.json", '{"name":"x"}').id).toBe("json");
  });

  test("falls back to extension lookup when no content matcher claims the file", () => {
    expect(documentRegistry.resolve("diagrams/web-app.json").id).toBe("json");
  });
});
