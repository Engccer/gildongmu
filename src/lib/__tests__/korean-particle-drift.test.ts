import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PARTICLE_CASES } from "./korean-particle.test";

/**
 * 조사 판정 웹-iOS 드리프트 가드(`format-drift.test.ts`와 같은 정신).
 *
 * 조사가 갈리면 같은 도로명이 웹에서는 "명일로를", iOS에서는 "명일로을"로 낭독된다.
 * Swift 구현이 표를 지키는지는 Kit `KoreanParticleTests`가 보고, **두 표가 같은지**는
 * 여기가 본다 — Swift 상수를 Swift 리터럴과 비교하는 테스트만으로는 웹이 바뀌어도
 * 실패하지 않기 때문이다.
 */

const SWIFT_TEST = "ios/GildongmuKit/Tests/GildongmuKitTests/KoreanParticleTests.swift";

/** Swift 테스트의 `particleCases` 표에서 `(단어, 목적격)`을 뽑는다. */
function swiftCases(source: string): [string, string][] {
  const block = /let particleCases: \[\(String, String\)\] = \[([\s\S]*?)\n\]/.exec(
    source,
  );
  if (!block) {
    throw new Error(`${SWIFT_TEST}에서 particleCases 표를 찾지 못했다`);
  }
  return [...block[1].matchAll(/\("([^"]*)",\s*"([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
}

/** 웹 정본을 Swift 표기(판정 불가 = `"-"`)로 옮긴다. */
const webCases: [string, string][] = PARTICLE_CASES.map((c) => [c.word, c.object ?? "-"]);

describe("조사 판정 웹-iOS 드리프트", () => {
  it("Swift 테스트의 표가 웹 정본과 같다", () => {
    expect(swiftCases(readFileSync(SWIFT_TEST, "utf8"))).toEqual(webCases);
  });

  it("가드 자체가 살아 있다 (표를 못 찾으면 조용히 통과하지 않는다)", () => {
    expect(() => swiftCases("let particleCases = []")).toThrow(/찾지 못했다/);
  });
});
