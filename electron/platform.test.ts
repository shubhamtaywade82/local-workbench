import { describe, expect, test } from "bun:test";
import {
  detectWsl,
  externalOpenCommand,
  sandboxAdvice,
  shouldDisableHardwareAcceleration,
  translateArgumentPath,
  windowsCommandShim,
  type WslInfo,
} from "./platform";

const WSL_PROC = "Linux version 5.15.167.4-microsoft-standard-WSL2 (root@1234) #1 SMP";
const UBUNTU: WslInfo = { distro: "Ubuntu", hasDisplay: true };

describe("detectWsl", () => {
  test("detects WSL from WSL_DISTRO_NAME and reports WSLg availability", () => {
    expect(detectWsl({ platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu", DISPLAY: ":0" } })).toEqual({
      distro: "Ubuntu",
      hasDisplay: true,
    });
  });

  test("falls back to the kernel release string when the env var is absent", () => {
    expect(detectWsl({ platform: "linux", env: {}, procVersion: WSL_PROC })).toEqual({
      distro: "",
      hasDisplay: false,
    });
  });

  test("a native Linux desktop is not WSL", () => {
    expect(detectWsl({ platform: "linux", env: { DISPLAY: ":0" }, procVersion: "Linux version 6.8.0-generic" })).toBeNull();
  });

  test("Windows and macOS are never WSL, even with WSL variables set", () => {
    expect(detectWsl({ platform: "win32", env: { WSL_DISTRO_NAME: "Ubuntu" } })).toBeNull();
    expect(detectWsl({ platform: "darwin", env: { WSL_DISTRO_NAME: "Ubuntu" } })).toBeNull();
  });

  test("an unset display is reported, so the launcher can explain WSLg is missing", () => {
    expect(detectWsl({ platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } })?.hasDisplay).toBe(false);
  });
});

describe("shouldDisableHardwareAcceleration", () => {
  test("is on inside WSL and off elsewhere", () => {
    expect(shouldDisableHardwareAcceleration(UBUNTU, {})).toBe(true);
    expect(shouldDisableHardwareAcceleration(null, {})).toBe(false);
  });

  test("LOCAL_WORKBENCH_GPU=1 restores hardware acceleration in WSL", () => {
    expect(shouldDisableHardwareAcceleration(UBUNTU, { LOCAL_WORKBENCH_GPU: "1" })).toBe(false);
  });
});

describe("translateArgumentPath", () => {
  test("outside WSL every path passes through unchanged", () => {
    expect(translateArgumentPath("C:\\Users\\me", null)).toEqual({ ok: true, path: "C:\\Users\\me" });
  });

  test("Windows drive paths map to /mnt/<drive> with forward slashes", () => {
    expect(translateArgumentPath("C:\\Users\\me\\projects\\app", UBUNTU)).toEqual({
      ok: true,
      path: "/mnt/c/Users/me/projects/app",
    });
    expect(translateArgumentPath("d:/work/notes/", UBUNTU)).toEqual({ ok: true, path: "/mnt/d/work/notes" });
  });

  test("a bare drive root maps to the mount point", () => {
    expect(translateArgumentPath("C:\\", UBUNTU)).toEqual({ ok: true, path: "/mnt/c" });
    expect(translateArgumentPath("C:", UBUNTU)).toEqual({ ok: true, path: "/mnt/c" });
  });

  test("a \\\\wsl.localhost path into this distribution maps to a Linux path", () => {
    expect(translateArgumentPath("\\\\wsl.localhost\\Ubuntu\\home\\me\\app", UBUNTU)).toEqual({
      ok: true,
      path: "/home/me/app",
    });
  });

  test("\\\\wsl$ paths and distribution names are matched case-insensitively", () => {
    expect(translateArgumentPath("\\\\wsl$\\ubuntu\\home\\me", UBUNTU)).toEqual({ ok: true, path: "/home/me" });
  });

  test("forward-slash UNC form is accepted too", () => {
    expect(translateArgumentPath("//wsl.localhost/Ubuntu/home/me", UBUNTU)).toEqual({ ok: true, path: "/home/me" });
  });

  test("the distribution root itself maps to /", () => {
    expect(translateArgumentPath("\\\\wsl.localhost\\Ubuntu", UBUNTU)).toEqual({ ok: true, path: "/" });
  });

  test("a path inside another distribution is refused with a useful message", () => {
    const result = translateArgumentPath("\\\\wsl.localhost\\Debian\\home\\me", UBUNTU);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/belongs to WSL distribution "Debian"/);
  });

  test("other network shares are refused", () => {
    const result = translateArgumentPath("\\\\fileserver\\share\\docs", UBUNTU);
    expect(result.ok).toBe(false);
  });

  test("Linux paths, relative paths and ~ are unchanged", () => {
    expect(translateArgumentPath("/home/me/app", UBUNTU)).toEqual({ ok: true, path: "/home/me/app" });
    expect(translateArgumentPath("../notes", UBUNTU)).toEqual({ ok: true, path: "../notes" });
    expect(translateArgumentPath("~/projects", UBUNTU)).toEqual({ ok: true, path: "~/projects" });
  });

  test("a UNC path is refused when the distribution name is unknown", () => {
    const result = translateArgumentPath("\\\\wsl.localhost\\Ubuntu\\x", { distro: "", hasDisplay: true });
    expect(result.ok).toBe(false);
  });
});

describe("sandboxAdvice", () => {
  const base = {
    apparmorRestrictsUserns: null,
    maxUserNamespaces: "62000",
    helperPath: "/opt/Local Workbench/chrome-sandbox",
    helperIsSetuidRoot: false,
  };

  test("no advice when user namespaces are available", () => {
    expect(sandboxAdvice(base)).toBeNull();
  });

  test("advice when AppArmor restricts unprivileged user namespaces and the helper is not setuid", () => {
    const advice = sandboxAdvice({ ...base, apparmorRestrictsUserns: "1" });
    expect(advice).toContain('sudo chown root "/opt/Local Workbench/chrome-sandbox"');
    expect(advice).toContain("sudo chmod 4755");
  });

  test("advice when user namespaces are disabled outright", () => {
    expect(sandboxAdvice({ ...base, maxUserNamespaces: "0" })).not.toBeNull();
  });

  test("no advice once the helper is setuid root, or when its state is unknown and not needed", () => {
    expect(sandboxAdvice({ ...base, apparmorRestrictsUserns: "1", helperIsSetuidRoot: true })).toBeNull();
    expect(sandboxAdvice({ ...base, helperIsSetuidRoot: null })).toBeNull();
  });
});

describe("externalOpenCommand", () => {
  test("inside WSL links open through the Windows shell", () => {
    expect(externalOpenCommand("https://example.com/a?b=1&c=2", UBUNTU)).toEqual({
      command: "explorer.exe",
      args: ["https://example.com/a?b=1&c=2"],
    });
  });

  test("elsewhere the platform opener is used", () => {
    expect(externalOpenCommand("https://example.com", null)).toBeNull();
  });
});

describe("windowsCommandShim", () => {
  test("forwards arguments and the current directory to the installing distribution", () => {
    const shim = windowsCommandShim({ distro: "Ubuntu" });
    expect(shim).toContain('wsl.exe -d Ubuntu --cd "%CD%" -- local-workbench %*');
    expect(shim.startsWith("@echo off")).toBe(true);
  });

  test("without a distribution the default distribution is used", () => {
    expect(windowsCommandShim({ distro: "" })).toContain('wsl.exe --cd "%CD%" -- local-workbench %*');
  });
});
