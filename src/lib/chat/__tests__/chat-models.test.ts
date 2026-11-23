import { describe, expect, it, vi } from "vitest";

const gates = vi.hoisted(() => ({ openai: true, anthropic: true }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    env: { ...actual.env, GILDONGMU_OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" },
    hasOpenAiKey: () => gates.openai,
    hasAnthropicKey: () => gates.anthropic,
  };
});

import { availableChatModels, createChatModelBudget, createChatModelSession, parseChatModel } from "../chat-models";

describe("parseChatModel (E89 C2)", () => {
  it("알려진 다섯 값만 통과, 나머지는 null(= 종전 Gemini 경로)", () => {
    for (const ok of ["openai", "openai-luna", "claude-opus", "claude-sonnet", "claude-haiku"]) expect(parseChatModel(ok)).toBe(ok);
    for (const bad of [undefined, null, "", "gemini", "google", "OPENAI", " openai", 1, {}, ["openai"]]) expect(parseChatModel(bad)).toBeNull();
  });
});

describe("availableChatModels·createChatModelSession 게이트", () => {
  it("키별로 함께 서고 함께 빠진다, 순서 고정", () => {
    gates.openai = true;
    gates.anthropic = true;
    expect(availableChatModels()).toEqual(["openai", "openai-luna", "claude-opus", "claude-sonnet", "claude-haiku"]);
    gates.openai = false;
    expect(availableChatModels()).toEqual(["claude-opus", "claude-sonnet", "claude-haiku"]);
    const input = { systemInstruction: "", declarations: [], history: [] };
    expect(createChatModelSession({ ...input, id: "openai" })).toBeNull();
    expect(createChatModelSession({ ...input, id: "claude-haiku" })).not.toBeNull();
    gates.anthropic = false;
    expect(availableChatModels()).toEqual([]);
    expect(createChatModelSession({ ...input, id: "claude-opus" })).toBeNull();
    gates.openai = true;
    gates.anthropic = true;
  });
});

describe("하루 상한 (E89 C10)", () => {
  it("상한까지 받고 넘으면 거절, KST 자정에 다시 연다", () => {
    const b = createChatModelBudget(2);
    const kstNoon = Date.UTC(2026, 10, 23, 3); // 2026-11-23 12:00 KST
    expect(b.reserve(kstNoon)).toBe(true);
    expect(b.reserve(kstNoon)).toBe(true);
    expect(b.reserve(kstNoon)).toBe(false);
    const nextKstDay = Date.UTC(2026, 10, 23, 15); // 2026-11-24 00:00 KST
    expect(b.reserve(nextKstDay)).toBe(true);
  });
});
