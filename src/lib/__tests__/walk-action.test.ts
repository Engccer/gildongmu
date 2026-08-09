import { describe, expect, it } from "vitest";

import cases from "./fixtures/walk-action-cases.json";
import { walkStepAction, type WalkAction } from "../walk-action";

describe("walkStepAction 공유 경계표", () => {
  for (const c of (cases as { cases: { desc: string; expect: WalkAction | null }[] }).cases) {
    it(`${c.desc || "(빈 문장)"} → ${c.expect ?? "null"}`, () => {
      expect(walkStepAction(c.desc)).toBe(c.expect);
    });
  }
});
