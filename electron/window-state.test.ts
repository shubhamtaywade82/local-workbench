import { describe, expect, test } from "bun:test";
import { DEFAULT_WINDOW_STATE, parseWindowState, placeOnScreen } from "./window-state";

const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 };

describe("window state", () => {
  test("a valid saved state is restored", () => {
    const saved = { bounds: { x: 10, y: 20, width: 1200, height: 800 }, isMaximized: true, theme: "light" };
    expect(parseWindowState(saved)).toEqual(saved as never);
  });

  test("garbage falls back to defaults field by field", () => {
    expect(parseWindowState(null)).toEqual(DEFAULT_WINDOW_STATE);
    expect(parseWindowState({ bounds: { x: "1" }, isMaximized: "yes", theme: "blue" })).toEqual(DEFAULT_WINDOW_STATE);
  });

  test("a window still on a display keeps its position", () => {
    const bounds = { x: 100, y: 100, width: 800, height: 600 };
    expect(placeOnScreen(bounds, [SCREEN])).toEqual(bounds);
  });

  test("a window left on an unplugged monitor keeps only its size", () => {
    const bounds = { x: 2500, y: 100, width: 800, height: 600 };
    expect(placeOnScreen(bounds, [SCREEN])).toEqual({ width: 800, height: 600 });
  });
});
