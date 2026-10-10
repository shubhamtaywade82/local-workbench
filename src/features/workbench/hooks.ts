// Small client-side hooks used by the workbench.

"use client";

import { useEffect, useState } from "react";

/** Debounce a fast-changing value. */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Like useDebounced but also returns a pending flag for spinner display.
 *  `pending` is derived purely from comparing the latest value against the
 *  currently-debounced snapshot — no setState is called inside the effect
 *  body, so React's set-state-in-effect rule is satisfied. */
export function useDebouncedWithPending<T>(
  value: T,
  delayMs = 200
): { debounced: T; pending: boolean } {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  // After debounce settles, debounced === value and pending is false.
  // On a new change, value updates first, debounced catches up later —
  // so the inequality window is exactly the pending window.
  const pending = debounced !== value;
  return { debounced, pending };
}
