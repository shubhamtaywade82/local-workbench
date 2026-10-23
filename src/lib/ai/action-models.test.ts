/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { AI_ACTIONS, resolveActionModel, type AiAction } from "./action-models";

const FALLBACK = "llama3.1:8b";

const KEYS: Readonly<Record<AiAction, string>> = {
  chat: "AI_MODEL_CHAT",
  fix: "AI_MODEL_FIX",
  explain: "AI_MODEL_EXPLAIN",
  convert: "AI_MODEL_CONVERT",
  diagram: "AI_MODEL_DIAGRAM",
  improve: "AI_MODEL_IMPROVE",
};

function run(action: AiAction, env: Record<string, string | undefined>) {
  const warnings: string[] = [];
  const model = resolveActionModel(action, env, FALLBACK, (message) => warnings.push(message));
  return { model, warnings };
}

describe("resolveActionModel", () => {
  test("uses the fallback when the override is unset", () => {
    expect(run("fix", {})).toEqual({ model: FALLBACK, warnings: [] });
  });

  test("uses the fallback when the override is blank", () => {
    expect(run("fix", { AI_MODEL_FIX: "   " })).toEqual({ model: FALLBACK, warnings: [] });
  });

  test("returns the override with surrounding whitespace removed", () => {
    expect(run("fix", { AI_MODEL_FIX: "  minicpm5-coding-agent \n" }).model).toBe("minicpm5-coding-agent");
  });

  test.each([
    "minicpm5-coding-agent",
    "llama3.1:8b",
    "openbmb/minicpm5-2b",
    "gpt-4o-mini",
    "qwen2.5-coder:7b-instruct-q4_K_M",
  ])("accepts the model name %s", (name) => {
    expect(run("chat", { AI_MODEL_CHAT: name })).toEqual({ model: name, warnings: [] });
  });

  test.each([
    ["contains a space", "minicpm5 coding"],
    ["contains a double quote", 'model"x'],
    ["contains a shell metacharacter", "model;rm"],
    ["starts with a dash", "-model"],
    ["contains a newline", "model\nAI_MODEL_FIX=evil"],
    ["is longer than 128 characters", "a".repeat(129)],
  ])("rejects a value that %s and falls back with a warning", (_label, value) => {
    const { model, warnings } = run("fix", { AI_MODEL_FIX: value });
    expect(model).toBe(FALLBACK);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("AI_MODEL_FIX");
    expect(warnings[0]).not.toContain(value.trim());
  });

  test("accepts a name of exactly 128 characters", () => {
    const name = `a${"b".repeat(127)}`;
    expect(run("fix", { AI_MODEL_FIX: name }).model).toBe(name);
  });

  for (const action of AI_ACTIONS) {
    test(`${action} reads its own AI_MODEL_* variable`, () => {
      expect(run(action, { [KEYS[action]]: "m-override" }).model).toBe("m-override");
    });

    test(`${action} ignores the variables of every other action`, () => {
      for (const other of AI_ACTIONS) {
        if (other === action) continue;
        expect(run(action, { [KEYS[other]]: "m-other" }).model).toBe(FALLBACK);
      }
    });
  }
});
