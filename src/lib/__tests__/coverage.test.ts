import { describe, expect, it } from "vitest";
import {
  isInKorea,
  KOREA_COVERAGE_BBOX,
  metersOutsideSeoul,
  SEOUL_BBOX,
} from "@/lib/coverage";

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

describe("metersOutsideSeoul", () => {
  it("서울 안은 0 (도심·강동·강서 외곽)", () => {
    expect(metersOutsideSeoul(37.5665, 126.978)).toBe(0);
    expect(metersOutsideSeoul(37.5385, 127.1234)).toBe(0);
    expect(metersOutsideSeoul(37.578, 126.8)).toBe(0);
  });

  it("서울 인접 시는 bbox 안이거나 근소하게 밖 (경계를 시도로 자르지 않는 근거)", () => {
    // 하남 미사·과천·고양 화정은 bbox 안 — 서울 대여소·행사가 반경에 들어올 수 있다.
    expect(metersOutsideSeoul(37.562, 127.193)).toBe(0);
    expect(metersOutsideSeoul(37.4292, 126.9877)).toBe(0);
    // 성남 판교는 남쪽으로 살짝 밖이지만 3km 안(문화행사 서비스권)
    expect(metersOutsideSeoul(37.395, 127.111)).toBeLessThan(3000);
  });

  it("원거리는 실측 거리에 근접 (부산 ~300km · 춘천 ~50km)", () => {
    expect(metersOutsideSeoul(35.1578, 129.0594)).toBeGreaterThan(250_000);
    const chuncheon = metersOutsideSeoul(37.88, 127.729);
    expect(chuncheon).toBeGreaterThan(40_000);
    expect(chuncheon).toBeLessThan(60_000);
  });

  it("bbox 상수는 음향신호기 seed 생성 필터와 같은 값", () => {
    expect(SEOUL_BBOX).toEqual({ latMin: 37.4, latMax: 37.72, lngMin: 126.73, lngMax: 127.2 });
  });
});
