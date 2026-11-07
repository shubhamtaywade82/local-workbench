// The layout the viewport can hold: a phone shows one pane at a time, a tablet
// shows the editor with one side pane and the assistant as a sheet, and a
// desktop shows every pane. Read as an external store, so it is safe during
// server rendering and updates when the window is resized across a threshold.

"use client";

import { useSyncExternalStore } from "react";

export type Breakpoint = "phone" | "tablet" | "desktop";

export const TABLET_QUERY = "(min-width: 768px)";
export const DESKTOP_QUERY = "(min-width: 1280px)";

function subscribe(onChange: () => void): () => void {
  const tablet = window.matchMedia(TABLET_QUERY);
  const desktop = window.matchMedia(DESKTOP_QUERY);
  tablet.addEventListener("change", onChange);
  desktop.addEventListener("change", onChange);
  return () => {
    tablet.removeEventListener("change", onChange);
    desktop.removeEventListener("change", onChange);
  };
}

export function breakpointNow(): Breakpoint {
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "phone";
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, breakpointNow, () => "desktop");
}
