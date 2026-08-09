import { describe, expect, it } from "vitest";

import cases from "./fixtures/walk-action-cases.json";
import { walkStepAction, type WalkAction } from "../walk-action";

describe("walkStepAction 공유 경계표", () => {
  // fixture가 비거나 키가 바뀌면 아래 루프가 0개 테스트로 조용히 통과한다.
  it("fixture에 케이스가 있다", () => {
    expect(cases.cases.length).toBeGreaterThanOrEqual(14);
  });

  for (const c of (cases as { cases: { desc: string; expect: WalkAction | null }[] }).cases) {
    it(`${c.desc || "(빈 문장)"} → ${c.expect ?? "null"}`, () => {
      expect(walkStepAction(c.desc)).toBe(c.expect);
    });
  }
});
