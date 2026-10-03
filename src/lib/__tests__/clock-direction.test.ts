import { describe, expect, it } from "vitest";
import cases from "./fixtures/clock-direction-cases.json";
import { clockHour, relativeBearing } from "../clock-direction";

describe("시계 방향 체계(공유 fixture)", () => {
  it.each(cases.cases)("기준 $reference° → 대상 $target° = $hour시", (c) => {
    const rel = relativeBearing(c.reference, c.target);
    expect(rel).toBeGreaterThanOrEqual(0);
    expect(rel).toBeLessThan(360);
    expect(rel).toBeCloseTo(c.relative, 6);
    expect(clockHour(rel)).toBe(c.hour);
  });

  it("반올림 경계는 0.5 올림이다(15°는 1시, 345°는 12시)", () => {
    expect(clockHour(15)).toBe(1);
    expect(clockHour(345)).toBe(12);
    expect(clockHour(165)).toBe(6);
  });
});
