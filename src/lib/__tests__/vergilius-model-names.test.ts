import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPENAI_VERGILIUS_MODEL } from "../vergilius/openai";
import { GOOGLE_VERGILIUS_MODEL } from "../vergilius/google";

/**
 * 실험판 설정 「답변 모델」의 화면 이름은 모델 이름이다(E82, 위원장 2026-11-15). 서버 식별자 `openai`·`google`이 가리키는
 * 모델은 서버 상수가 정하므로, 서버에서 모델을 바꾸고 앱 이름을 그대로 두면 설정이 다른 모델을 고르는 것처럼 들린다.
 */
const KIT = readFileSync(
  join(process.cwd(), "ios/GildongmuKit/Sources/GildongmuKit/Vergilius.swift"),
  "utf8",
);

const displayName = (id: string) => new RegExp(`case "${id}": "([^"]+)"`).exec(KIT)?.[1];

/** "GPT-6.1 Terra" → "gpt-6.1-terra", "Gemini 3.5 Flash-Lite" → "gemini-3.5-flash-lite" */
const slug = (name: string) => name.toLowerCase().replace(/ /g, "-");

describe("베르길리우스 답변 모델 화면 이름", () => {
  it("OpenAI·Google 선택지의 이름이 서버 모델 상수와 같은 모델이다", () => {
    // 이름을 못 찾으면(`displayName` 구조가 바뀌면) 빈 문자열 비교로 흐려지지 않게 먼저 단언한다.
    expect(displayName("openai"), "Kit displayName openai").toBeDefined();
    expect(displayName("google"), "Kit displayName google").toBeDefined();
    expect(slug(displayName("openai") ?? "")).toBe(OPENAI_VERGILIUS_MODEL);
    expect(slug(displayName("google") ?? "")).toBe(GOOGLE_VERGILIUS_MODEL);
  });
});
