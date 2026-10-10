// Theme provider. Reads the workbench store's `theme` value and applies the
// `dark` class to <html> so Tailwind v4 picks it up.

"use client";

import { useEffect, type ReactNode } from "react";
import { useWorkbench } from "@/features/workbench/store";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useWorkbench((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    root.style.colorScheme = theme;
  }, [theme]);
  return <>{children}</>;
}
