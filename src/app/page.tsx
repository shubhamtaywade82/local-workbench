"use client";

import dynamic from "next/dynamic";
import { ErrorBoundary } from "@/features/workbench/shell/error-boundary";

const WorkbenchShell = dynamic(
  () =>
    import("@/features/workbench/shell/workbench-shell").then(
      (m) => m.WorkbenchShell
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Booting workbench…</span>
        </div>
      </div>
    ),
  }
);

export default function Home() {
  return (
    <ErrorBoundary>
      <WorkbenchShell />
    </ErrorBoundary>
  );
}
