import { afterEach, describe, expect, it } from "vitest";
import { __resetToolBudgetForTest, checkBudget, consumeBudget } from "../tool-budget";

afterEach(__resetToolBudgetForTest);

describe("tool-budget(spec §5.5)", () => {
  it("쿨다운 안이면 retryAfterMs가 결정적이다", () => {
    consumeBudget("search", 1_000);
    expect(checkBudget("search", 2_000)).toEqual({ ok: false, retryAfterMs: 2_000 });
    expect(checkBudget("search", 4_000)).toEqual({ ok: true });
    consumeBudget("stationArrivals", 0);
    expect(checkBudget("stationArrivals", 9_999)).toEqual({ ok: false, retryAfterMs: 1 });
  });

  it("시간당 30회를 넘기면 창이 열릴 때까지 cooldown이다", () => {
    for (let i = 0; i < 30; i++) consumeBudget("search", i * 10_000);
    expect(checkBudget("search", 300_000)).toEqual({ ok: false, retryAfterMs: 3_600_000 - 300_000 });
  });

  it("확인만으로는 소비되지 않는다(재직렬화 무과금의 근거)", () => {
    expect(checkBudget("barrierFree", 0)).toEqual({ ok: true });
    expect(checkBudget("barrierFree", 1)).toEqual({ ok: true });
  });
});
