import { describe, expect, test } from "bun:test";

import { detectArchifyDiagramType } from "./detect";

describe("detectArchifyDiagramType", () => {
  test("recognises each declared diagram type", () => {
    expect(detectArchifyDiagramType('{"schema_version":1,"diagram_type":"erd","meta":{}}')).toBe("erd");
    expect(detectArchifyDiagramType('{"diagram_type":"waterfall"}')).toBe("waterfall");
  });

  test("keeps the identity of a document that is mid-edit", () => {
    const halfTyped = '{\n  "schema_version": 1,\n  "diagram_type": "architecture",\n  "components": [\n    { "id": "a"';
    expect(detectArchifyDiagramType(halfTyped)).toBe("architecture");
  });

  test("ignores a diagram_type that only appears inside a string value", () => {
    expect(detectArchifyDiagramType('{"note":"set \\"diagram_type\\": \\"erd\\" later"}')).toBeNull();
  });

  test("rejects unknown or non-string diagram types", () => {
    expect(detectArchifyDiagramType('{"diagram_type":"pie"}')).toBeNull();
    expect(detectArchifyDiagramType('{"diagram_type":["erd"]}')).toBeNull();
  });

  test("returns null for ordinary JSON and for non-object roots", () => {
    expect(detectArchifyDiagramType('{"name":"app","version":"1.0.0"}')).toBeNull();
    expect(detectArchifyDiagramType('["diagram_type"]')).toBeNull();
    expect(detectArchifyDiagramType("")).toBeNull();
  });
});
