// Host environment: WSL detection, Windows and UNC path translation, Linux
// sandbox diagnosis, and how external links are opened. Pure functions that take
// the environment as an argument, so they can be tested on any OS.

export interface HostEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Contents of /proc/version, when readable. */
  readonly procVersion?: string;
}

export interface WslInfo {
  /** Name of the distribution this process runs in (WSL_DISTRO_NAME). */
  readonly distro: string;
  /** True when WSLg (or another X server or Wayland compositor) is reachable. */
  readonly hasDisplay: boolean;
}

/** Returns WSL details when running inside WSL, otherwise null. */
export function detectWsl(host: HostEnvironment): WslInfo | null {
  if (host.platform !== "linux") return null;
  const looksLikeWsl =
    Boolean(host.env.WSL_DISTRO_NAME) ||
    Boolean(host.env.WSL_INTEROP) ||
    /microsoft|wsl/i.test(host.procVersion ?? "");
  if (!looksLikeWsl) return null;
  return {
    distro: host.env.WSL_DISTRO_NAME ?? "",
    hasDisplay: Boolean(host.env.WAYLAND_DISPLAY || host.env.DISPLAY),
  };
}

/**
 * Chromium's GPU path is unreliable under WSLg in some driver setups. The
 * editor does not need hardware acceleration, so software rendering is the
 * default inside WSL. LOCAL_WORKBENCH_GPU=1 turns it back on.
 */
export function shouldDisableHardwareAcceleration(
  wsl: WslInfo | null,
  env: Readonly<Record<string, string | undefined>>
): boolean {
  return wsl !== null && env.LOCAL_WORKBENCH_GPU !== "1";
}

export type PathArgument = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };

const DRIVE_PATH = /^([A-Za-z]):(?:[\\/](.*))?$/;
const WSL_UNC = /^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)(?:[\\/](.*))?$/i;
const OTHER_UNC = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;

/**
 * Converts a path typed in a Windows shell into the form WSL can use:
 *   C:\Users\me\app            -> /mnt/c/Users/me/app
 *   \\wsl.localhost\Ubuntu\home -> /home   (when Ubuntu is this distribution)
 * Other inputs are returned unchanged. Outside WSL nothing is translated.
 */
export function translateArgumentPath(input: string, wsl: WslInfo | null): PathArgument {
  if (wsl === null) return { ok: true, path: input };

  const drive = DRIVE_PATH.exec(input);
  if (drive) {
    const rest = (drive[2] ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    return { ok: true, path: `/mnt/${drive[1].toLowerCase()}${rest ? `/${rest}` : ""}` };
  }

  const unc = WSL_UNC.exec(input);
  if (unc) {
    const [, distro, rest] = unc;
    if (wsl.distro === "" || distro.toLowerCase() !== wsl.distro.toLowerCase()) {
      return {
        ok: false,
        message: `${input} belongs to WSL distribution "${distro}"; run local-workbench inside that distribution`,
      };
    }
    const tail = (rest ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    return { ok: true, path: `/${tail}` };
  }

  if (OTHER_UNC.test(input)) {
    return { ok: false, message: `network paths are not supported: ${input}` };
  }
  return { ok: true, path: input };
}

export interface SandboxFacts {
  /** Value of /proc/sys/kernel/apparmor_restrict_unprivileged_userns, or null when absent. */
  readonly apparmorRestrictsUserns: string | null;
  /** Value of /proc/sys/user/max_user_namespaces, or null when absent. */
  readonly maxUserNamespaces: string | null;
  /** Path of Electron's chrome-sandbox helper. */
  readonly helperPath: string;
  /** Whether the helper is owned by root with the setuid bit set, or null when it cannot be read. */
  readonly helperIsSetuidRoot: boolean | null;
}

/**
 * Explains how to fix a sandbox failure before Electron crashes with a
 * generic message. Returns null when no action is needed.
 *
 * Ubuntu 24.04 (including recent WSL images) sets
 * kernel.apparmor_restrict_unprivileged_userns=1, which blocks Chromium's
 * user-namespace sandbox. The setuid helper avoids that.
 */
export function sandboxAdvice(facts: SandboxFacts): string | null {
  const usernsBlocked =
    facts.apparmorRestrictsUserns === "1" || facts.maxUserNamespaces === "0";
  if (!usernsBlocked || facts.helperIsSetuidRoot === true) return null;
  return [
    "user namespaces are restricted on this system, so Electron's sandbox helper needs to be setuid root.",
    `Run once: sudo chown root "${facts.helperPath}" && sudo chmod 4755 "${facts.helperPath}"`,
  ].join("\n");
}

/** Command that opens a URL in the Windows default browser, when running in WSL. */
export function externalOpenCommand(url: string, wsl: WslInfo | null): { command: string; args: string[] } | null {
  if (wsl === null) return null;
  return { command: "explorer.exe", args: [url] };
}

/**
 * `local-workbench.cmd` for Windows, which forwards to the WSL distribution the
 * CLI was installed in. The shell's current directory is passed as a Windows
 * path, so relative arguments resolve where the user typed them.
 */
export function windowsCommandShim(options: { readonly distro: string }): string {
  const distroArg = options.distro ? `-d ${options.distro} ` : "";
  return [
    "@echo off",
    "rem Local Workbench, run inside WSL. Generated by `bun run desktop:install-cli --windows`.",
    `wsl.exe ${distroArg}--cd "%CD%" -- local-workbench %*`,
    "",
  ].join("\r\n");
}
