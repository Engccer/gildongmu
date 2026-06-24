import { describe, it, expect } from "vitest";
import { pickAnchor, shouldFallbackToWeb } from "../flow";

describe("pickAnchor", () => {
  const geo = { lat: 37.55, lng: 127.13 };
  const user = { lat: 37.54, lng: 127.14 };
  it("지오코딩 좌표가 있으면 그것을 우선(현재 위치를 누름)", () => {
    expect(pickAnchor(geo, user)).toBe(geo);
  });
  it("지오코딩 없으면 현재 위치로 폴백", () => {
    expect(pickAnchor(null, user)).toBe(user);
  });
  it("둘 다 없으면 null", () => {
    expect(pickAnchor(null, null)).toBeNull();
  });
});

describe("shouldFallbackToWeb", () => {
  it("0건 + Perplexity 키 있음 → true", () => {
    expect(shouldFallbackToWeb(0, true)).toBe(true);
  });
  it("0건 + 키 없음 → false", () => {
    expect(shouldFallbackToWeb(0, false)).toBe(false);
  });
  it("결과 있음 → false", () => {
    expect(shouldFallbackToWeb(3, true)).toBe(false);
  });
});
