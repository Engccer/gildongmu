import { describe, it, expect } from "vitest";
import { dist, transitQuickExitLine } from "../lib/formatters.js";
import { formatDistance } from "../../../../src/lib/format.js";
import { directionParticle, subjectParticle, topicParticle } from "../lib/korean-particle.js";
import * as webParticle from "../../../../src/lib/korean-particle.js";
import { quickExitText } from "../../../../src/lib/quick-exit-text.js";
import ko from "../../../../messages/ko.json" with { type: "json" };

/**
 * CLI `dist()`는 웹 `formatDistance`의 미러다. 갈리면 같은 거리가 웹·앱과 CLI에서
 * 다르게 낭독된다(종전엔 이 가드가 없었다).
 *
 * 웹 `src/lib/format.ts`는 React/Next 비의존 순수 모듈이라 이 패키지에서 직접
 * import해 **실행 대조**할 수 있다. Kit(Swift)은 실행할 수 없어 표 대조로 가는데
 * (`src/lib/__tests__/format-drift.test.ts`), 여기선 그럴 이유가 없다.
 */
describe("거리 표기 CLI-웹 드리프트", () => {
  // 경계·자리올림·소수 구간을 함께 훑는다. 표를 손으로 적지 않고 정본을 실행해
  // 대조하므로, 규칙이 바뀌면 두 구현이 함께 따라오지 않는 한 red가 된다.
  const inputs = [
    0, 1, 120, 120.4, 999, 999.6, 1000, 1049, 1050, 1187, 1500, 1950, 1999,
    3640, 9999, 10_000, 89_700, 123_456,
  ];

  it.each(inputs)("%dm에서 웹 정본과 같은 문자열", (meters) => {
    expect(dist(meters)).toBe(formatDistance(meters));
  });
});

/**
 * 빠른하차 문장도 같은 이유의 미러다. CLI는 i18n이 없어 ko 문구를 옮겨 적었고,
 * 갈리면 같은 하차역이 웹·앱과 CLI에서 다른 문장으로 낭독된다.
 */
describe("빠른하차 문장 CLI-웹 드리프트", () => {
  const t = (key: string, values?: Record<string, string>) =>
    ((ko.route.transit as Record<string, string>)[key] ?? key).replace(
      /\{(\w+)\}/g,
      (_, name: string) => values?.[name] ?? `{${name}}`,
    );

  const cases = [
    { elevator: { kind: "door" as const, doors: ["6-4"] }, stairs: { kind: "door" as const, doors: ["5-4"] } },
    { elevator: { kind: "door" as const, doors: ["6-2"] } },
    { stairs: { kind: "door" as const, doors: ["3-1"] } },
    { elevator: { kind: "between" as const, doors: ["3-2", "3-3"] } },
    { elevator: { kind: "between" as const, doors: ["3-2", "3-3"] }, stairs: { kind: "door" as const, doors: ["5-4"] } },
    { transfer: { kind: "door" as const, doors: ["5-2"] } },
    { transfer: { kind: "door" as const, doors: ["5-2"] }, elevator: { kind: "door" as const, doors: ["2-3"] } },
  ];

  it.each(cases)("%o에서 웹 정본과 같은 문자열", (quickExit) => {
    const leg = { mode: "subway" as const, minutes: 24, toName: "여의도", quickExit };
    expect(transitQuickExitLine(leg)).toBe(quickExitText(t, "여의도", quickExit));
  });

  it("값이 없으면 양쪽 다 침묵", () => {
    const leg = { mode: "subway" as const, minutes: 24, toName: "여의도" };
    expect(transitQuickExitLine(leg)).toBeNull();
    expect(quickExitText(t, "여의도", undefined)).toBeNull();
  });
});

/** 조사 판정도 같은 이유의 미러다(한눈에 보기 문장의 장소명·라벨 조사). */
describe("조사 판정 CLI-웹 드리프트", () => {
  const words = ["성내로", "명일로24길", "강동구청", "봉래면옥", "카페", "식당", "아이 놀 곳", "GS25", "스타벅스 R", ""];
  it.each(words)("%j에서 웹 정본과 같은 조사", (word) => {
    expect(subjectParticle(word)).toBe(webParticle.subjectParticle(word));
    expect(topicParticle(word)).toBe(webParticle.topicParticle(word));
    expect(directionParticle(word)).toBe(webParticle.directionParticle(word));
  });
});
