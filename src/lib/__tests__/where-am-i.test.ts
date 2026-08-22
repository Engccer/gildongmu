import { describe, it, expect } from "vitest";
import { stripRegionPrefix } from "../where-am-i";

/**
 * 행정동·도로명 접두 중복 제거 — `assembleWhereAmI`·`composeOverview`가 위치 문장을 만들 때
 * "서울특별시 강동구"가 두 번 낭독되는 것을 막는 순수 함수(Kit `stripRegionPrefix` 미러).
 */
describe("stripRegionPrefix", () => {
  it("도로명이 행정동의 시·구 접두로 시작하면 중복을 제거한다", () => {
    expect(stripRegionPrefix("서울특별시 강동구 길동", "서울특별시 강동구 천중로44길 74")).toBe(
      "천중로44길 74",
    );
  });

  it("접두가 겹치지 않는 도로명은 그대로 둔다", () => {
    expect(stripRegionPrefix("서울특별시 강동구 길동", "천호대로 1042")).toBe("천호대로 1042");
  });

  it("region이 없거나 토큰이 2개 미만이면 원문 유지", () => {
    expect(stripRegionPrefix(null, "서울특별시 강동구 천호대로 1042")).toBe(
      "서울특별시 강동구 천호대로 1042",
    );
    expect(stripRegionPrefix("길동", "서울특별시 강동구 천호대로 1042")).toBe(
      "서울특별시 강동구 천호대로 1042",
    );
  });

  it("접두가 단어 경계에서만 맞아야 한다(부분 문자열 오탐 금지)", () => {
    expect(stripRegionPrefix("서울특별시 강동구 길동", "서울특별시 강동구청길 1")).toBe(
      "서울특별시 강동구청길 1",
    );
  });
});
