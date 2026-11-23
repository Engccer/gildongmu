import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GEMINI_MODEL } from "../gemini/client";
import { CHAT_MODEL_IDS, CLAUDE_CHAT_SETTINGS, OPENAI_CHAT_SETTINGS } from "../chat/chat-models";

/**
 * 실험판 설정 「채팅 답변 모델」(E89)의 화면 이름은 모델 이름이다. 서버 식별자가 가리키는 모델은 서버 상수가 정하므로, 서버에서 모델을 바꾸고
 * 앱 이름을 그대로 두면 설정이 다른 모델을 고르는 것처럼 들린다(`vergilius-model-names.test.ts`와 같은 가드).
 */
const KIT = readFileSync(join(process.cwd(), "ios/GildongmuKit/Sources/GildongmuKit/ChatAnswerModel.swift"), "utf8");
const displayName = (id: string) => new RegExp(`case "${id}": "([^"]+)"`).exec(KIT)?.[1];
/** "GPT-6.1 Terra" → "gpt-6.1-terra", "Gemini 3.6 Flash" → "gemini-3.6-flash" */
const slug = (name: string) => name.toLowerCase().replace(/ /g, "-");

describe("채팅 답변 모델 화면 이름", () => {
  it("Gemini·OpenAI 이름은 서버 모델 상수와 같은 모델이다", () => {
    const expected: Record<string, string> = {
      gemini: GEMINI_MODEL,
      openai: OPENAI_CHAT_SETTINGS.openai.model,
      "openai-luna": OPENAI_CHAT_SETTINGS["openai-luna"].model,
    };
    for (const [id, model] of Object.entries(expected)) {
      expect(displayName(id), `Kit displayName ${id}`).toBeDefined();
      expect(slug(displayName(id) ?? ""), id).toBe(model);
    }
  });

  it("Claude 이름은 같은 계열의 모델이다(버전은 이름에 싣지 않는다)", () => {
    for (const id of ["claude-opus", "claude-sonnet", "claude-haiku"] as const) {
      const name = displayName(id);
      expect(name, `Kit displayName ${id}`).toBeDefined();
      expect(CLAUDE_CHAT_SETTINGS[id].model.startsWith(slug(name ?? "x"))).toBe(true);
    }
  });

  it("서버가 여는 다섯 값은 모두 앱 화면 순서에 있다(앱이 모르는 값은 선택지에서 조용히 빠진다)", () => {
    const order = /displayOrder = \[([^\]]+)\]/.exec(KIT)?.[1] ?? "";
    for (const id of CHAT_MODEL_IDS) expect(order, id).toContain(`"${id}"`);
  });
});
