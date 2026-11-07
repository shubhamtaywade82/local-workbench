// Remembers window size, position, maximized state and theme between launches,
// so the app reopens where it was left, in the right colors, without a flash.

import { readFileSync, writeFileSync } from "node:fs";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowState {
  readonly bounds: Rect | null;
  readonly isMaximized: boolean;
  readonly theme: "light" | "dark";
}

export const DEFAULT_WINDOW_STATE: WindowState = { bounds: null, isMaximized: false, theme: "dark" };

function isRect(value: unknown): value is Rect {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((key) => Number.isFinite(rect[key]));
}

/** Validates untrusted JSON, falling back to defaults field by field. */
export function parseWindowState(raw: unknown): WindowState {
  if (typeof raw !== "object" || raw === null) return DEFAULT_WINDOW_STATE;
  const state = raw as Record<string, unknown>;
  return {
    bounds: isRect(state.bounds) ? state.bounds : null,
    isMaximized: state.isMaximized === true,
    theme: state.theme === "light" ? "light" : "dark",
  };
}

/**
 * Drops the saved position when it no longer overlaps any display (a monitor
 * was unplugged), so the window is not restored off screen. The size is kept.
 */
export function placeOnScreen(bounds: Rect, workAreas: readonly Rect[]): Partial<Rect> {
  const visible = workAreas.some(
    (area) =>
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
  );
  return visible ? bounds : { width: bounds.width, height: bounds.height };
}

export function loadWindowState(file: string): WindowState {
  try {
    return parseWindowState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    // Missing or corrupt on first launch or after a crash; defaults are fine.
    return DEFAULT_WINDOW_STATE;
  }
}

export function saveWindowState(file: string, state: WindowState): void {
  writeFileSync(file, JSON.stringify(state, null, 2));
}
