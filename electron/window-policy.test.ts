import { describe, expect, test } from "bun:test";
import { contentSecurityPolicy, externalUrlToOpen, isAppUrl, originOf } from "./window-policy";

const APP = "http://127.0.0.1:41000";

describe("window policy", () => {
  test("app pages and their subresources are same-origin", () => {
    expect(isAppUrl("http://127.0.0.1:41000/", APP)).toBe(true);
    expect(isAppUrl("http://127.0.0.1:41000/api/ai/chat?x=1", APP)).toBe(true);
    expect(isAppUrl("blob:http://127.0.0.1:41000/3f2b", APP)).toBe(true);
  });

  test("another port, host or scheme is a different origin", () => {
    expect(isAppUrl("http://127.0.0.1:41001/", APP)).toBe(false);
    expect(isAppUrl("http://localhost:41000/", APP)).toBe(false);
    expect(isAppUrl("https://127.0.0.1:41000/", APP)).toBe(false);
  });

  test("opaque and malformed URLs are not app URLs", () => {
    expect(isAppUrl("javascript:alert(1)", APP)).toBe(false);
    expect(isAppUrl("data:text/html,hi", APP)).toBe(false);
    expect(isAppUrl("file:///etc/passwd", APP)).toBe(false);
    expect(isAppUrl("not a url", APP)).toBe(false);
    expect(originOf("data:text/html,hi")).toBeNull();
  });

  test("only http and https links are handed to the system browser", () => {
    expect(externalUrlToOpen("https://example.com/docs?q=1")).toBe("https://example.com/docs?q=1");
    expect(externalUrlToOpen("http://example.com")).toBe("http://example.com/");
    expect(externalUrlToOpen("file:///home/me/.ssh/id_rsa")).toBeNull();
    expect(externalUrlToOpen("javascript:alert(1)")).toBeNull();
    expect(externalUrlToOpen("ms-msdt:/id PCWDiagnostic")).toBeNull();
    expect(externalUrlToOpen("garbage")).toBeNull();
  });

  test("the production policy allows only the app origin and forbids eval", () => {
    const csp = contentSecurityPolicy({ devServer: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/connect-src[^;]*ws:/);
  });

  test("the development policy adds eval and the hot-reload websocket", () => {
    const csp = contentSecurityPolicy({ devServer: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toMatch(/connect-src 'self' ws: wss:/);
  });
});
