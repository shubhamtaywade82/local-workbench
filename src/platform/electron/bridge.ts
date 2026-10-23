// Renderer-side access to the desktop bridge. Returns null in a browser, so
// callers fall back to the web workspace implementations.

import { DESKTOP_GLOBAL, type DesktopBridge } from "@/lib/desktop/contract";

declare global {
  interface Window {
    workbenchDesktop?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as Record<string, DesktopBridge | undefined>)[DESKTOP_GLOBAL] ?? null;
}
