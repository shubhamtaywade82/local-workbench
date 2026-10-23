// Constant-time check for the per-launch desktop token. Server-only.

import { timingSafeEqual } from "node:crypto";

/**
 * True when `presented` equals `expected`. An absent header or an empty
 * expected token never matches, so a misconfigured server fails closed.
 */
export function isValidDesktopToken(presented: string | null, expected: string): boolean {
  if (presented === null || expected === "") return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
