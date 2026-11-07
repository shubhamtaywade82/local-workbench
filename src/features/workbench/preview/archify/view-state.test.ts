import { describe, expect, test } from "bun:test";

import type { ArchifyRenderFailure, ArchifyRenderSuccess } from "@/lib/archify/contract";

import {
  archifyDiagnosticsFor,
  archifyStatus,
  initialArchifyViewState,
  reduceArchifyView,
  type ArchifyViewState,
} from "./view-state";

const validation = {
  checksPassed: 9,
  checkCount: 9,
  compositionProfile: "showcase",
  compositionStatus: "pass",
  errors: 0,
  warnings: 0,
  warningDetails: [],
};

function verified(html: string, sha256 = `sha-${html}`): ArchifyRenderSuccess {
  return { ok: true, type: "architecture", quality: "showcase", html, sha256, bytes: html.length, cached: false, validation };
}

function failed(message = "bad"): ArchifyRenderFailure {
  return { ok: false, stage: "input", message, diagnostics: [{ code: "schema/enum", severity: "error", message, supportedFixes: ["fix it"] }], cached: false };
}

function apply(state: ArchifyViewState, source: string, outcome: ArchifyRenderSuccess | ArchifyRenderFailure): ArchifyViewState {
  return reduceArchifyView(state, { type: "outcome", source, outcome });
}

describe("archify last-good view state", () => {
  test("starts checking, then shows the first verified revision", () => {
    expect(archifyStatus(initialArchifyViewState, "a")).toBe("checking");
    const state = apply(initialArchifyViewState, "a", verified("<svg>1</svg>"));
    expect(state.verified?.revision).toBe(1);
    expect(archifyStatus(state, "a")).toBe("verified");
  });

  test("keeps the last verified diagram when the draft fails", () => {
    const good = apply(initialArchifyViewState, "a", verified("<svg>1</svg>"));
    const bad = apply(good, "b", failed());
    expect(bad.verified?.html).toBe("<svg>1</svg>");
    expect(bad.failure?.message).toBe("bad");
    expect(archifyStatus(bad, "b")).toBe("needs-fix");
  });

  test("recovers to a new revision when the draft becomes valid again", () => {
    let state = apply(initialArchifyViewState, "a", verified("<svg>1</svg>"));
    state = apply(state, "b", failed());
    state = apply(state, "c", verified("<svg>2</svg>"));
    expect(state.verified?.revision).toBe(2);
    expect(state.verified?.html).toBe("<svg>2</svg>");
    expect(state.failure).toBeNull();
    expect(archifyStatus(state, "c")).toBe("verified");
  });

  test("does not bump the revision when the same bytes verify again", () => {
    const first = apply(initialArchifyViewState, "a", verified("<svg>1</svg>", "same"));
    const second = apply(first, "a2", verified("<svg>1</svg>", "same"));
    expect(second.revisionCounter).toBe(1);
    expect(second.verified).toBe(first.verified);
  });

  test("reports checking while the draft has moved past the last outcome", () => {
    const state = apply(initialArchifyViewState, "a", verified("<svg>1</svg>"));
    expect(archifyStatus(state, "a-with-an-edit")).toBe("checking");
  });

  test("a failure before any verified revision leaves nothing to show", () => {
    const state = apply(initialArchifyViewState, "a", failed());
    expect(state.verified).toBeNull();
    expect(archifyStatus(state, "a")).toBe("needs-fix");
  });
});

describe("archify verdict for Problems", () => {
  test("lists every failure diagnostic with its rule code and fixes", () => {
    const state = apply(initialArchifyViewState, "a", failed("bad type"));
    const entries = archifyDiagnosticsFor(state, "diagrams/a.json");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ filePath: "diagrams/a.json", severity: "error", source: "archify", code: "schema/enum" });
    expect(entries[0]?.message).toBe("[schema/enum] bad type Fix: fix it");
  });

  test("lists composition warnings for a verified revision with warnings", () => {
    const warned = {
      ...verified("<svg>w</svg>"),
      validation: {
        ...validation,
        warnings: 1,
        warningDetails: [{ code: "composition/viewport-height", message: "compact vertical spacing" }],
      },
    };
    const state = apply(initialArchifyViewState, "a", warned);
    expect(archifyDiagnosticsFor(state, "a.json")).toEqual([
      {
        filePath: "a.json",
        severity: "warning",
        message: "[composition/viewport-height] compact vertical spacing",
        source: "archify",
        code: "composition/viewport-height",
      },
    ]);
  });

  test("is empty for a clean verified revision and before any outcome", () => {
    expect(archifyDiagnosticsFor(initialArchifyViewState, "a.json")).toEqual([]);
    expect(archifyDiagnosticsFor(apply(initialArchifyViewState, "a", verified("<svg/>")), "a.json")).toEqual([]);
  });

  test("uses the stage when a runtime failure has no diagnostics", () => {
    const busy = { ok: false as const, stage: "busy", message: "renderer busy", diagnostics: [], cached: false };
    const state = apply(initialArchifyViewState, "a", busy);
    expect(archifyDiagnosticsFor(state, "a.json")[0]?.message).toBe("[busy] renderer busy");
  });
});
