import { describe, expect, it } from "vitest";
import { congestionLevelKey } from "../congestion-level";

/**
 * 등급어는 닫힌 집합이라 앱에서 번역하지만, provider는 원문을 통과시킨다.
 * 이 표가 비면 비한국어 사용자에게 한국어 등급어가 그대로 낭독된다 —
 * 정보 소실은 아니지만 번역 계층이 죽은 것이므로 테스트로 못 박는다.
 */
describe("congestionLevelKey", () => {
  it.each([
    ["여유", "relaxed"],
    ["보통", "normal"],
    ["약간 붐빔", "slightlyBusy"],
    ["붐빔", "busy"],
  ])("%s → %s", (raw, key) => {
    expect(congestionLevelKey(raw)).toBe(key);
  });

  it("4단계를 모두 덮는다(하나라도 빠지면 그 등급만 원문 낭독된다)", () => {
    const keys = ["여유", "보통", "약간 붐빔", "붐빔"].map(congestionLevelKey);
    expect(new Set(keys).size).toBe(4);
    expect(keys).not.toContain(null);
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(congestionLevelKey("  붐빔 ")).toBe("busy");
  });

  it("표에 없는 값은 null(원문 낭독으로 폴백 — 서울시가 단계를 늘려도 빈 값이 되지 않는다)", () => {
    expect(congestionLevelKey("매우 붐빔")).toBeNull();
    expect(congestionLevelKey("")).toBeNull();
  });

  it("'붐빔'과 '약간 붐빔'을 혼동하지 않는다(부분 문자열 오탐)", () => {
    expect(congestionLevelKey("약간 붐빔")).not.toBe("busy");
  });
});
