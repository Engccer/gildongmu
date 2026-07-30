import { describe, it, expect } from "vitest";
import { bearingDegrees, bearingToCompass8 } from "../bearing";
import { haversineMeters } from "../../geo";

describe("bearingDegrees (북=0, 시계방향)", () => {
  const O = { lat: 37.5, lng: 127.0 };
  it("정북(위도 증가) → ~0도", () => {
    expect(bearingDegrees(O.lat, O.lng, 37.51, 127.0)).toBeCloseTo(0, 0);
  });
  it("정동(경도 증가) → ~90도", () => {
    expect(bearingDegrees(O.lat, O.lng, 37.5, 127.01)).toBeCloseTo(90, 0);
  });
  it("정남(위도 감소) → ~180도", () => {
    expect(bearingDegrees(O.lat, O.lng, 37.49, 127.0)).toBeCloseTo(180, 0);
  });
  it("정서(경도 감소) → ~270도", () => {
    expect(bearingDegrees(O.lat, O.lng, 37.5, 126.99)).toBeCloseTo(270, 0);
  });
});

describe("bearingToCompass8", () => {
  it.each([
    [0, "n"], [22, "n"], [45, "ne"], [90, "e"], [135, "se"],
    [180, "s"], [225, "sw"], [270, "w"], [315, "nw"], [359, "n"],
  ])("%i도 → %s", (deg, dir) => {
    expect(bearingToCompass8(deg as number)).toBe(dir);
  });
  it("음수·360+ 정규화", () => {
    expect(bearingToCompass8(-45)).toBe("nw");
    expect(bearingToCompass8(405)).toBe("ne");
  });
});

describe("haversineMeters", () => {
  it("동일 좌표 → 0", () => {
    expect(haversineMeters(37.5, 127.0, 37.5, 127.0)).toBeCloseTo(0, 0);
  });
  it("위도 0.01도(~1.1km) → 1000~1200m", () => {
    const d = haversineMeters(37.5, 127.0, 37.51, 127.0);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1200);
  });
});
