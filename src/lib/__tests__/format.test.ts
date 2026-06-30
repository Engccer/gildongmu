import { describe, it, expect } from "vitest";
import { formatDistance, durationToMinutes, joinText } from "../format";

describe("formatDistance", () => {
  it("1km 미만은 m, 반올림", () => {
    expect(formatDistance(120.4)).toBe("120m");
    expect(formatDistance(999)).toBe("999m");
  });
  it("1km 이상은 km, 소수 1자리", () => {
    expect(formatDistance(1000)).toBe("1.0km");
    expect(formatDistance(3640)).toBe("3.6km");
  });
});

describe("durationToMinutes", () => {
  it("올림, 최소 1분", () => {
    expect(durationToMinutes(0)).toBe(1);
    expect(durationToMinutes(61)).toBe(2);
  });
});

describe("joinText (스크린 리더 한 줄 합치기)", () => {
  it("조각을 쉼표+공백으로 합친다", () => {
    expect(joinText("강남", "2호선, 신분당선", "약 120m")).toBe(
      "강남, 2호선, 신분당선, 약 120m",
    );
  });
  it("falsy 조각(선택 항목)은 버린다", () => {
    expect(joinText("성수행", "2호선", false, null, undefined, "")).toBe(
      "성수행, 2호선",
    );
  });
  it("조건부 배지를 cond && text로 흡수한다", () => {
    const express = true;
    const transfer = false;
    expect(joinText("성수행", express && "급행", transfer && "환승역")).toBe(
      "성수행, 급행",
    );
  });
  it("단일·빈 입력", () => {
    expect(joinText("강남")).toBe("강남");
    expect(joinText()).toBe("");
    expect(joinText(false, null, "")).toBe("");
  });
  it("가운뎃점을 구분자로 쓰지 않는다(쉼표만)", () => {
    expect(joinText("a", "b")).not.toContain("·");
  });
});
