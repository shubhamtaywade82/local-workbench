// Theme provider. Reads the workbench store's `theme` value and applies the
// `dark` class to <html> so Tailwind v4 picks it up. Also syncs to localStorage.

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWorkbench } from "@/features/workbench/store";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useWorkbench((s) => s.theme);
  const setTheme = useWorkbench((s) => s.setTheme);
  const mountedRef = useRef(false);
  const [mounted, setMounted] = useState(false);

  // Apply theme to DOM and persist to localStorage
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      setMounted(true);
      // Sync from localStorage on mount (set by inline script)
      try {
        const stored = localStorage.getItem("workbench-theme");
        if (stored && stored !== theme) {
          setTheme(stored as "dark" | "light");
        }
      } catch {}
    }
    if (!mounted) return;
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    root.style.colorScheme = theme;
    try {
      localStorage.setItem("workbench-theme", theme);
    } catch {}
  }, [theme, mounted, setTheme]);

  if (!mounted) {
    return <>{children}</>;
  }
  return <>{children}</>;
}
