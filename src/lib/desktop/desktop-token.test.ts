import { describe, expect, test } from "bun:test";
import { isValidDesktopToken } from "./desktop-token";

describe("isValidDesktopToken", () => {
  const secret = "a".repeat(64);

  test("accepts the exact token", () => {
    expect(isValidDesktopToken(secret, secret)).toBe(true);
  });

  test("rejects a missing header", () => {
    expect(isValidDesktopToken(null, secret)).toBe(false);
  });

  test("rejects an empty presented value", () => {
    expect(isValidDesktopToken("", secret)).toBe(false);
  });

  test("rejects a token of a different length without throwing", () => {
    expect(isValidDesktopToken("a".repeat(63), secret)).toBe(false);
    expect(isValidDesktopToken("a".repeat(65), secret)).toBe(false);
  });

  test("rejects a same-length token that differs in one character", () => {
    expect(isValidDesktopToken(`${"a".repeat(63)}b`, secret)).toBe(false);
  });

  test("fails closed when the server has no expected token", () => {
    expect(isValidDesktopToken("", "")).toBe(false);
    expect(isValidDesktopToken("anything", "")).toBe(false);
  });
});
