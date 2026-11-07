import { describe, expect, test } from "bun:test";

import { convertDeterministically, sourceFormatOf } from "./convert";

describe("convertDeterministically", () => {
  test("converts JSON to YAML and back, without a model", () => {
    const yaml = convertDeterministically('{"name":"workbench","ports":[3000]}', "json", "yaml");
    expect(yaml).toContain("name: workbench");
    const json = convertDeterministically(yaml ?? "", "yaml", "json");
    expect(JSON.parse(json ?? "")).toEqual({ name: "workbench", ports: [3000] });
  });

  test("converts JSON to TOML", () => {
    expect(convertDeterministically('{"title":"x","port":3000}', "json", "toml")).toContain('title = "x"');
  });

  test("converts JSON to TOON through the TOON adapter", () => {
    const toon = convertDeterministically('{"name":"workbench"}', "json", "toon");
    expect(toon).toContain("workbench");
    expect(convertDeterministically(toon ?? "", "toon", "json")).toBe(`${JSON.stringify({ name: "workbench" }, null, 2)}\n`);
  });

  test("returns the source unchanged when the formats match", () => {
    expect(convertDeterministically("{ \"a\": 1 }", "json", "json")).toBe("{ \"a\": 1 }");
  });

  test("returns null for markdown or XML, and for unparseable source", () => {
    expect(convertDeterministically("# Title", "markdown", "json")).toBeNull();
    expect(convertDeterministically("<a/>", "xml", "json")).toBeNull();
    expect(convertDeterministically("{not json", "json", "yaml")).toBeNull();
  });
});

describe("sourceFormatOf", () => {
  test("maps the Archify adapter back to JSON", () => {
    expect(sourceFormatOf("archify")).toBe("json");
    expect(sourceFormatOf("yaml")).toBe("yaml");
  });
});
