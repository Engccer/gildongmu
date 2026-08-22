import { describe, expect, it } from "vitest";
import cases from "./fixtures/car-action-cases.json";
import corpus from "./fixtures/tmap-car-corpus.json";
import { carActionFromTurnType } from "../car-action";

describe("carActionFromTurnType 공유 fixture(Kit CarActionTests 동형)", () => {
  for (const c of cases.cases) {
    it(`turnType ${c.turnType} → ${c.action ?? "null"}${c.note ? ` (${c.note})` : ""}`, () => {
      expect(carActionFromTurnType(c.turnType)).toBe(c.action);
    });
  }

  it("코퍼스 관측 turnType은 전부 fixture 표에 있다(새 코드 관측 시 표 갱신 강제)", () => {
    const known = new Set(cases.cases.map((c) => c.turnType));
    const observed = new Set((corpus as { turnType: number }[]).map((s) => s.turnType));
    for (const t of observed) expect(known.has(t), `turnType ${t} 미등재`).toBe(true);
  });
});
