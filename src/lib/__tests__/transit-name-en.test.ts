import { describe, expect, it } from "vitest";
import cases from "./fixtures/transit-name-en-cases.json";
import { isDisplayableEnglish, normalizeTransitNameEn, toDisplayEnglish } from "../transit-name-en";

describe("normalizeTransitNameEn — ODsay 영문 정류소명 표시 정규화(E27 §3.2)", () => {
  for (const c of cases.cases) {
    it(`${c.input} → ${c.expected}`, () => {
      expect(normalizeTransitNameEn(c.input)).toBe(c.expected);
    });
  }

  it("멱등 — 정규화 결과를 다시 넣어도 같다", () => {
    for (const c of cases.cases) {
      expect(normalizeTransitNameEn(c.expected)).toBe(c.expected);
    }
  });

  it("정규화 결과에 ㆍ·Stn.·겹친 마침표가 남지 않는다(게이트 4 동형)", () => {
    for (const c of cases.cases) {
      const out = normalizeTransitNameEn(c.input);
      expect(out).not.toMatch(/[ㆍ·]/);
      expect(out).not.toMatch(/Stn\./);
      expect(out).not.toMatch(/\.\./);
    }
  });
});

describe("toDisplayEnglish — 필드 존재 ≠ 영문(설계 리뷰 #12)", () => {
  it("한글이 섞인 값·빈 값·비문자열은 undefined(필드 부재)", () => {
    expect(toDisplayEnglish("서초03")).toBeUndefined();
    expect(toDisplayEnglish("8146(새벽맞춤버스)")).toBeUndefined();
    expect(toDisplayEnglish("")).toBeUndefined();
    expect(toDisplayEnglish("   ")).toBeUndefined();
    expect(toDisplayEnglish(undefined)).toBeUndefined();
    expect(toDisplayEnglish(12)).toBeUndefined();
  });
  it("영문·숫자·기호만이면 정규화본을 돌려준다", () => {
    expect(toDisplayEnglish("Seocho03")).toBe("Seocho03");
    expect(toDisplayEnglish("8146(Saebyeok Matchum Bus & Pyeongil Unhaeng)")).toBe(
      "8146(Saebyeok Matchum Bus & Pyeongil Unhaeng)",
    );
    expect(isDisplayableEnglish("Line 9 Express")).toBe(true);
  });
});
