import { describe, expect, it } from "vitest";
import fixture from "./fixtures/stale-fix-age-cases.json";
import { staleFixAge } from "../stale-origin";

describe("staleFixAge — 공유 fixture 동조", () => {
  for (const c of fixture.ageCases) {
    it(c.name, () => {
      expect(staleFixAge(c.ageSeconds)).toEqual(c.expect);
    });
  }

  it("비유한 값은 null(시각을 모르면 옛 위치가 아니다)", () => {
    expect(staleFixAge(Number.NaN)).toBeNull();
    expect(staleFixAge(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
