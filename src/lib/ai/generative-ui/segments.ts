/**
 * Splits an assistant message into plain-text and OpenUI Lang segments.
 *
 * Only fences tagged `openui-lang` (or `openui`) become UI. Every other fence
 * (```json, ```yaml, ...) stays text — the workbench routinely shows document
 * snippets, and OpenUI's own `stripFences` would feed those to the UI parser.
 *
 * Line-based and streaming-safe: an unterminated UI fence yields a segment with
 * `complete: false`, and while streaming a trailing half-typed fence line
 * (e.g. "```openui-l") is held back instead of flashing as text.
 */

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "ui"; code: string; complete: boolean };

const UI_FENCE_LANGS = new Set(["openui-lang", "openui"]);
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+-]*)[ \t]*$/;
const PARTIAL_FENCE = /^ {0,3}(`{1,}|~{1,})[A-Za-z0-9_+-]*$/;

function isClosingFence(line: string, marker: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < marker.length) return false;
  const ch = marker[0];
  for (const c of trimmed) if (c !== ch) return false;
  return true;
}

export function splitMessageSegments(
  content: string,
  options: { streaming?: boolean } = {}
): MessageSegment[] {
  const lines = content.split("\n");

  // While streaming, the last line may be an incomplete fence opener.
  if (options.streaming && lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last.length > 0 && PARTIAL_FENCE.test(last)) lines.pop();
  }

  const segments: MessageSegment[] = [];
  let text: string[] = [];
  let ui: string[] | null = null;
  let otherFence: string | null = null;

  const flushText = () => {
    const joined = text.join("\n").replace(/^\s*\n/, "").trimEnd();
    if (joined.trim().length > 0) segments.push({ kind: "text", text: joined });
    text = [];
  };

  for (const line of lines) {
    if (ui !== null) {
      if (isClosingFence(line, "```")) {
        segments.push({ kind: "ui", code: ui.join("\n"), complete: true });
        ui = null;
      } else {
        ui.push(line);
      }
      continue;
    }
    if (otherFence !== null) {
      text.push(line);
      if (isClosingFence(line, otherFence)) otherFence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && UI_FENCE_LANGS.has(open[2].toLowerCase())) {
      flushText();
      ui = [];
      continue;
    }
    if (open) otherFence = open[1];
    text.push(line);
  }

  if (ui !== null) {
    flushText();
    segments.push({ kind: "ui", code: ui.join("\n"), complete: false });
  } else {
    flushText();
  }
  return segments;
}

/** True if the message contains at least one OpenUI Lang block. */
export function hasUiSegment(content: string): boolean {
  return splitMessageSegments(content).some((s) => s.kind === "ui");
}
