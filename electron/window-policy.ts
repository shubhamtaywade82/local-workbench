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

export interface CspOptions {
  /** Next.js development server: needs eval and a websocket for hot reload. */
  readonly devServer: boolean;
}

/**
 * Content-Security-Policy for pages served by the local app. The page is
 * privileged, so its own script, its workers and its network access are
 * restricted to the app origin. Next's inline bootstrap and Monaco's inline
 * styles still need 'unsafe-inline'.
 */
export function contentSecurityPolicy({ devServer }: CspOptions): string {
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(devServer ? ["'unsafe-eval'"] : [])];
  const connectSrc = ["'self'", ...(devServer ? ["ws:", "wss:"] : [])];
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
