import { describe, it, expect } from "vitest";
import {
  CLOSER_TONES,
  FARTHER_TONES,
  NEARBY_TONES,
  TICK_TONES,
} from "../beacon-tones";

describe("beacon-tones", () => {
  it("CLOSER는 상승(낮은음→높은음)", () => {
    expect(CLOSER_TONES.length).toBeGreaterThanOrEqual(2);
    expect(CLOSER_TONES[1].freq).toBeGreaterThan(CLOSER_TONES[0].freq);
  });
  it("FARTHER는 하강(높은음→낮은음)", () => {
    expect(FARTHER_TONES[1].freq).toBeLessThan(FARTHER_TONES[0].freq);
  });
  it("NEARBY·TICK은 비어있지 않다", () => {
    expect(NEARBY_TONES.length).toBeGreaterThan(0);
    expect(TICK_TONES.length).toBe(1);
  });
  it("모든 톤은 양의 freq·dur", () => {
    for (const arr of [CLOSER_TONES, FARTHER_TONES, NEARBY_TONES, TICK_TONES]) {
      for (const t of arr) {
        expect(t.freq).toBeGreaterThan(0);
        expect(t.dur).toBeGreaterThan(0);
        expect(t.start).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
