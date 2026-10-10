"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
     
    console.error("[Workbench ErrorBoundary]", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
          <div className="max-w-2xl rounded-lg border border-destructive/40 bg-destructive/5 p-6">
            <h2 className="mb-2 text-lg font-semibold text-destructive">
              Workbench render error
            </h2>
            <p className="mb-3 text-sm">
              {this.state.error.message}
            </p>
            <pre className="max-h-[400px] overflow-auto rounded border bg-muted/40 p-3 text-[10px] leading-tight">
              <code>{this.state.error.stack}</code>
            </pre>
            <button
              onClick={this.reset}
              className="mt-4 rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
