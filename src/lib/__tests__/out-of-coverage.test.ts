import { describe, expect, it } from "vitest";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";

describe("isOutOfCoverageBody", () => {
  it("마커 body만 true", () => {
    expect(isOutOfCoverageBody({ outOfCoverage: true })).toBe(true);
    expect(isOutOfCoverageBody({ weather: null })).toBe(false);
    expect(isOutOfCoverageBody(null)).toBe(false);
    expect(isOutOfCoverageBody({ outOfCoverage: false })).toBe(false);
  });
});
