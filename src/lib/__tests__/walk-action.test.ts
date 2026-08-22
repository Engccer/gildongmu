import { describe, expect, it } from "vitest";

import cases from "./fixtures/walk-action-cases.json";
import { imminentTone, walkStepAction, type WalkAction } from "../walk-action";

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

describe("imminentTone — 갈래 선택은 회전과 같은 소리(K2 §3.1, Kit WalkActionTests 동형)", () => {
  it("keepLeft → left, keepRight → right", () => {
    expect(imminentTone("keepLeft")).toBe("left");
    expect(imminentTone("keepRight")).toBe("right");
  });
  it("walkStepAction은 keep*을 내지 않는다(도보 문형에 없다 — 자동차 갈래 문장도 침묵)", () => {
    expect(walkStepAction("한남대교남단에서 한남대교 방면으로 오른쪽 길로 들어선 뒤 올림픽대로를 따라 500m 이동")).toBeNull();
  });
});
