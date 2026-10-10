/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { toProposedEditRequest } from "./generative-message";
import { PROPOSE_EDIT_ACTION } from "@/lib/ai/generative-ui/components";

const event = (type: string, params: Record<string, unknown>) => ({
  type,
  params,
  humanFriendlyMessage: "",
});

describe("toProposedEditRequest", () => {
  test("accepts a well-formed propose-edit action", () => {
    expect(
      toProposedEditRequest(event(PROPOSE_EDIT_ACTION, { label: "Fix", description: "why", newText: "x: 1" }))
    ).toEqual({ label: "Fix", description: "why", newText: "x: 1" });
  });

  test("defaults the label and omits an empty description", () => {
    expect(toProposedEditRequest(event(PROPOSE_EDIT_ACTION, { label: "", description: "", newText: "a" }))).toEqual({
      label: "Proposed edit",
      newText: "a",
    });
  });

  test.each([
    ["missing newText", { label: "Fix" }],
    ["empty newText", { label: "Fix", newText: "" }],
    ["non-string newText", { label: "Fix", newText: 42 }],
  ])("rejects %s", (_name, params) => {
    expect(toProposedEditRequest(event(PROPOSE_EDIT_ACTION, params))).toBeNull();
  });

  test.each(["open_url", "continue_conversation", "workbench.apply_edit", ""])(
    "ignores action type %p (generated UI cannot navigate or write)",
    (type) => {
      expect(toProposedEditRequest(event(type, { url: "https://evil.example", newText: "x" }))).toBeNull();
    }
  );
});
