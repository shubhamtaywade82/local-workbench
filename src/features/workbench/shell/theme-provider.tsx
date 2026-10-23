// Theme provider. Reads the workbench store's `theme` value and applies the
// `dark` class to <html> so Tailwind v4 picks it up. Also syncs to localStorage.

"use client";

import { useEffect, type ReactNode } from "react";
import { useWorkbench } from "@/features/workbench/store";
import { useIsClient } from "@/lib/hooks/use-is-client";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useWorkbench((s) => s.theme);
  const setTheme = useWorkbench((s) => s.setTheme);
  const mounted = useIsClient();

  // The inline script in layout.tsx has already applied the stored theme before
  // first paint. Here the store catches up with what is stored.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("workbench-theme");
      if (stored === "dark" || stored === "light") setTheme(stored);
    } catch {}
  }, [setTheme]);

  // Apply theme to DOM and persist to localStorage
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    root.style.colorScheme = theme;
    try {
      localStorage.setItem("workbench-theme", theme);
    } catch {}
  }, [theme, mounted]);

  return <>{children}</>;
}
