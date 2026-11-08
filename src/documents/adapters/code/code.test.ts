import { describe, expect, test } from "bun:test";

import { documentRegistry } from "@/documents/core/registry";
import {
  codeAdapters,
  diffAdapter,
  pythonAdapter,
  typescriptAdapter,
} from "./code";

describe("code document adapters", () => {
  test("configures typescript adapter with ts/tsx", () => {
    expect(typescriptAdapter.extensions).toContain("ts");
    expect(typescriptAdapter.extensions).toContain("tsx");
    expect(typescriptAdapter.languageId).toBe("typescript");
  });

  test("configures python adapter with py", () => {
    expect(pythonAdapter.extensions).toContain("py");
    expect(pythonAdapter.languageId).toBe("python");
  });

  test("produces diff preview model for patch files", () => {
    const diff = "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new";
    const preview = diffAdapter.createPreview(diff, "changes.diff");
    expect(preview).toEqual({ kind: "diff", source: diff });
  });

  test("produces code preview model with language id", () => {
    const py = "def add(a, b):\n    return a + b";
    const preview = pythonAdapter.createPreview(py, "math.py");
    expect(preview).toEqual({ kind: "code", source: py, language: "python" });
  });
});

describe("document registry code resolution", () => {
  for (const adapter of codeAdapters) {
    documentRegistry.register(adapter);
  }

  test("resolves code extensions to respective adapters", () => {
    expect(documentRegistry.resolve("main.py").languageId).toBe("python");
    expect(documentRegistry.resolve("script.sh").languageId).toBe("shell");
    expect(documentRegistry.resolve("schema.sql").languageId).toBe("sql");
    expect(documentRegistry.resolve("component.tsx").languageId).toBe("typescript");
    expect(documentRegistry.resolve("changes.diff").languageId).toBe("diff");
  });
});
