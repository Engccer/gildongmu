import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SPEECH_DEFER_GAP_S,
  SPEECH_DEFER_MAX_S,
  SPEECH_DEFER_THRESHOLD_S,
  speechDeferStep,
} from "../guide-speech-gate";

/**
 * 톤 뒤 발화 판정(spec 2026-08-14 §3·§8) — 경계 표는 실측 톤 길이로 고정한다.
 * 판정 축이 톤 이름이 아니라 "남은 재생 시간"이라, 재생 직후의 remaining은 곧 톤
 * 전체 길이다. 이 표가 바뀌면 mp3 실측(afinfo)부터 다시 할 것.
 */
describe("speechDeferStep 경계 표", () => {
  // 즉시(짧은 톤): closer/farther 0.235 · unreliable 0.470 · tick 0.522
  it.each([0.235, 0.47, 0.522])("잔여 %s초 → 즉시(0)", (len) => {
    expect(speechDeferStep(0, len)).toBe(0);
  });

  // 지연(긴 톤): ahead 0.731 · warning 0.836 · start/stop 1.332 · nearby 2.246
  it.each([0.731, 0.836, 1.332, 2.246])("잔여 %s초 → 잔여+0.15", (len) => {
    expect(speechDeferStep(0, len)).toBe(len + SPEECH_DEFER_GAP_S);
  });

  it("경계 remaining == 0.6은 지연이다(미만만 즉시)", () => {
    expect(speechDeferStep(0, SPEECH_DEFER_THRESHOLD_S)).toBe(
      SPEECH_DEFER_THRESHOLD_S + SPEECH_DEFER_GAP_S,
    );
  });

  it("이미 끝난 톤(remaining 음수)은 즉시", () => {
    expect(speechDeferStep(10, 9)).toBe(0);
  });

  // 상한은 clamp이지 무효화가 아니다(리뷰 MINOR 1 — 0으로 만들면 경계 역전).
  it.each([2.9, 3.5, 100])("잔여 %s초 → 3.0 clamp", (len) => {
    expect(speechDeferStep(0, len)).toBe(SPEECH_DEFER_MAX_S);
  });

  // 비유한 값은 両인자 모두 검사한다(리뷰 MINOR 2 — NaN은 모든 비교를 통과해
  // setTimeout(NaN) 즉시 실행·Swift 나노초 변환 trap으로 흘러간다).
  it.each([
    [0, null],
    [0, Number.NaN],
    [0, Number.POSITIVE_INFINITY],
    [0, Number.NEGATIVE_INFINITY],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
  ] as [number, number | null][])("비유한 입력(now=%s, toneEndsAt=%s) → 0", (now, endsAt) => {
    expect(speechDeferStep(now, endsAt)).toBe(0);
  });
});

/**
 * 웹↔Kit 드리프트 가드(`guide-motion-drift.test.ts` 선례): 한쪽 상수만 바꾸면 그쪽
 * 스위트도 함께 바뀌어 조용히 통과하므로, Swift 선언을 정규식으로 읽어 값 대조한다.
 */
const KIT = path.resolve(
  __dirname,
  "../../../ios/GildongmuKit/Sources/GildongmuKit/GuideSpeechGate.swift",
);

const PAIRS: [number, string][] = [
  [SPEECH_DEFER_THRESHOLD_S, "speechDeferThresholdSeconds"],
  [SPEECH_DEFER_GAP_S, "speechDeferGapSeconds"],
  [SPEECH_DEFER_MAX_S, "speechDeferMaxSeconds"],
];

describe("발화 지연 상수 웹↔Kit 동조", () => {
  const swift = readFileSync(KIT, "utf8");

  for (const [webValue, swiftName] of PAIRS) {
    it(`${swiftName} = ${webValue}`, () => {
      const m = swift.match(new RegExp(`static let ${swiftName}\\s*=\\s*(-?[0-9.]+)`));
      expect(m, `Swift에 ${swiftName} 선언이 없다`).not.toBeNull();
      expect(Number(m![1])).toBe(webValue);
    });
  }

  it("Swift 상수 표에 웹이 모르는 항목이 없다(한쪽만 추가되는 드리프트 차단)", () => {
    const declared = [...swift.matchAll(/static let (\w+)\s*=\s*-?[0-9.]+/g)].map((m) => m[1]);
    expect(new Set(declared)).toEqual(new Set(PAIRS.map(([, name]) => name)));
  });
});
