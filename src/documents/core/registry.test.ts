import { describe, expect, test } from "bun:test";

import { ensureAdaptersRegistered } from "@/documents/bootstrap";
import { documentRegistry } from "@/documents/core/registry";

describe("documentRegistry.isSupported", () => {
  test("recognizes supported file formats after bootstrap", async () => {
    await ensureAdaptersRegistered();

    expect(documentRegistry.isSupported("data.csv")).toBe(true);
    expect(documentRegistry.isSupported("metrics.tsv")).toBe(true);
    expect(documentRegistry.isSupported("icon.svg")).toBe(true);
    expect(documentRegistry.isSupported("server.ts")).toBe(true);
    expect(documentRegistry.isSupported("script.py")).toBe(true);
    expect(documentRegistry.isSupported("deploy.sh")).toBe(true);
    expect(documentRegistry.isSupported("notes.txt")).toBe(true);
    expect(documentRegistry.isSupported("page.html")).toBe(true);
    expect(documentRegistry.isSupported("Dockerfile")).toBe(true);
    expect(documentRegistry.isSupported(".gitignore")).toBe(true);
  });

  test("rejects unsupported binary and document formats", async () => {
    await ensureAdaptersRegistered();

    expect(documentRegistry.isSupported("archive.zip")).toBe(false);
    expect(documentRegistry.isSupported("package.tar.gz")).toBe(false);
    expect(documentRegistry.isSupported("image.png")).toBe(false);
    expect(documentRegistry.isSupported("photo.jpg")).toBe(false);
    expect(documentRegistry.isSupported("document.pdf")).toBe(false);
    expect(documentRegistry.isSupported("app.exe")).toBe(false);
    expect(documentRegistry.isSupported("font.woff2")).toBe(false);
    expect(documentRegistry.isSupported("data.bin")).toBe(false);
  });
});
