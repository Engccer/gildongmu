import { describe, expect, it } from "vitest";
import { isInKorea, KOREA_COVERAGE_BBOX } from "@/lib/coverage";

describe("isInKorea", () => {
  it("한국 좌표는 true (서울·제주·독도)", () => {
    expect(isInKorea(37.5665, 126.978)).toBe(true);
    expect(isInKorea(33.4996, 126.5312)).toBe(true);
    expect(isInKorea(37.2422, 131.8674)).toBe(true);
  });
  it("해외 좌표는 false (샌프란시스코·도쿄·파리)", () => {
    expect(isInKorea(37.7749, -122.4194)).toBe(false);
    expect(isInKorea(35.6762, 139.6503)).toBe(false);
    expect(isInKorea(48.8566, 2.3522)).toBe(false);
  });
  it("경계 상수는 deeplink 유래 값(31.43~44.35 / 122.37~132.0)", () => {
    expect(KOREA_COVERAGE_BBOX).toEqual({ latMin: 31.43, latMax: 44.35, lngMin: 122.37, lngMax: 132.0 });
  });
});
