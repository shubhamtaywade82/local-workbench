// Navigation and window-open policy for the workbench window. Pure functions so
// they can be tested without Electron.
//
// The window is privileged: it talks to the filesystem bridge. It must only ever
// show the local app. Anything else is handed to the operating system's
// browser, and only if it is plain http(s).

export function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export function isAppUrl(url: string, appOrigin: string): boolean {
  return originOf(url) === appOrigin;
}

/** Returns the URL normalized for `shell.openExternal`, or null when it must not be opened. */
export function externalUrlToOpen(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
