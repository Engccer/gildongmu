import { describe, expect, it } from "vitest";
import fixture from "./fixtures/step-text-says-direction-cases.json";
import { stepTextSaysDirection } from "../guide-live-rows";
import type { WalkAction } from "../walk-action";

/**
 * 조각 없는 스텝 문장이 스스로 방향을 말하는가(A58) — Kit `StepTextSaysDirectionFixtureTests`·`:kit` `GuideLiveRowsTest`와
 * 같은 공유 판정표를 읽는다.
 */
describe("stepTextSaysDirection — 공유 판정표", () => {
  it("판정표가 비어 있지 않다", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(16);
  });

  it.each(fixture.cases)("$id", (c) => {
    const action = (c as { action?: WalkAction }).action;
    expect(stepTextSaysDirection(action, c.hasBody)).toBe(c.expected);
  });
});
