// Contract shared by the Electron main process, the preload script, the
// Next.js request guard and the renderer. Keep this module free of runtime
// imports: the preload bundle must not pull in Node built-ins, and the
// renderer must not pull in Electron.

import type { WorkspaceFileEntry } from "@/documents/core/types";

/**
 * Header the Electron main process attaches to every `/api/*` request it
 * sends to the local Next.js server. Requests without it are rejected when
 * `WORKBENCH_DESKTOP_TOKEN` is set on the server.
 */
export const DESKTOP_TOKEN_HEADER = "x-workbench-desktop-token";

/** Environment variable carrying the per-launch secret into the Next.js server. */
export const DESKTOP_TOKEN_ENV = "WORKBENCH_DESKTOP_TOKEN";

/** `window` property the preload script exposes to the renderer. */
export const DESKTOP_GLOBAL = "workbenchDesktop";

export const DESKTOP_CHANNELS = {
  launchTarget: "workbench:launch-target",
  chooseWorkspace: "workbench:choose-workspace",
  fs: "workbench:fs",
  command: "workbench:command",
} as const;

/** Describes the workspace a window is bound to. */
export interface DesktopLaunchTarget {
  /**
   * Binding token. Every filesystem request carries it, so a renderer that
   * still holds a handle to a previous folder fails instead of writing into
   * the new one.
   */
  readonly token: string;
  /** Directory basename, shown in the UI. */
  readonly name: string;
  /** Stable id derived from the canonical path. Disambiguates equal basenames. */
  readonly rootId: string;
  /** Root-relative file to open in the editor, when launched with a file path. */
  readonly openFile: string | null;
}

/** Pushed from the main process to the renderer. */
export type DesktopCommand =
  | { readonly kind: "open-folder" }
  | { readonly kind: "open-file"; readonly path: string };

export type DesktopErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_PATH"
  | "CONFLICT"
  | "TOO_LARGE"
  | "UNSUPPORTED"
  | "STALE_WORKSPACE"
  | "INTERNAL";

/** Filesystem request. `token` must match the window's current binding. */
export type DesktopFsRequest =
  | { readonly method: "list"; readonly token: string; readonly path: string }
  | { readonly method: "read"; readonly token: string; readonly path: string }
  | { readonly method: "write"; readonly token: string; readonly path: string; readonly contents: string }
  | { readonly method: "create"; readonly token: string; readonly path: string; readonly contents: string }
  | { readonly method: "mkdir"; readonly token: string; readonly path: string }
  | { readonly method: "rename"; readonly token: string; readonly path: string; readonly newPath: string }
  | { readonly method: "delete"; readonly token: string; readonly path: string };

/**
 * Results cross the context bridge as values rather than thrown errors:
 * Electron does not preserve custom error properties across that boundary.
 */
export type DesktopFsResult =
  | { readonly ok: true; readonly value: WorkspaceFileEntry[] | string | null }
  | { readonly ok: false; readonly code: DesktopErrorCode; readonly message: string };

/** The object exposed as `window.workbenchDesktop`. */
export interface DesktopBridge {
  getLaunchTarget(): Promise<DesktopLaunchTarget | null>;
  /** Shows the native folder picker and binds this window to the chosen folder. */
  chooseWorkspace(): Promise<DesktopLaunchTarget | null>;
  fs(request: DesktopFsRequest): Promise<DesktopFsResult>;
  onCommand(listener: (command: DesktopCommand) => void): void;
}

/** Thrown in the renderer when a desktop filesystem request fails. */
export class DesktopFsError extends Error {
  constructor(
    readonly code: DesktopErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DesktopFsError";
  }
}
