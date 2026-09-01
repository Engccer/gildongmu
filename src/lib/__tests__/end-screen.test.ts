import { describe, expect, it } from "vitest";
import fixture from "./fixtures/end-screen-stale-cases.json";
import { END_SCREEN_STALE_S, isEndScreenStale } from "../end-screen";
import { IDLE_RESET_MS } from "../idle-reset";

describe("isEndScreenStale (공유 fixture)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(isEndScreenStale(c.secondsSinceEnd)).toBe(c.expect);
    });
  }

  it("NaN·무한은 소거하지 않는다", () => {
    expect(isEndScreenStale(NaN)).toBe(false);
    expect(isEndScreenStale(Infinity)).toBe(false);
  });

  it("앱 유휴 리셋(10분)보다 넉넉하다 — 잠깐 다른 앱을 보고 돌아오는 사용을 자르지 않는 하한", () => {
    expect(END_SCREEN_STALE_S * 1000).toBeGreaterThan(IDLE_RESET_MS);
  });
});
