import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import type { GuideRoute } from "@/lib/route-guide";
import type { WalkAction } from "@/lib/walk-action";
import { headedUnitText } from "../useRouteGuide";

/**
 * 자동 재조회 채택 문장의 방향 머리말(E63 §3.7) — 조각 없는 첫 스텝이 스스로 방향을 말하면 머리말을 붙이지 않는다(A58,
 * 문안 확정본 "방향 구절이 겹치는 자리": 방향은 하나만). iOS `GuideText.headedUnit`·안드로이드 `GuideTextTest` 같은 케이스.
 */

type GuideT = Parameters<typeof headedUnitText>[5];
const tKo = createTranslator({ locale: "ko", messages: ko, namespace: "guide" }) as unknown as GuideT;
const tEn = createTranslator({ locale: "en", messages: en, namespace: "guide" }) as unknown as GuideT;

function route(steps: { description: string; action?: WalkAction }[]): GuideRoute {
  return {
    polyline: { points: [], cum: [] },
    totalMeters: 0,
    steps: steps.map((s, index) => ({ index, ...s, startD: index * 50, endD: index * 50 + 50, isLong: true })),
  };
}

describe("en 첫 스텝이 자기 회전을 말하면 머리말 없음(A58)", () => {
  it("회전 스텝: 머리말을 붙이지 않는다", () => {
    const r = route([{ description: "Turn left, then walk 30m", action: "left" }]);
    expect(headedUnitText(r, [0], [{}], 2, true, tEn)).toBe("Turn left, then walk 30m");
  });

  it("방향을 박은 횡단 스텝: 머리말을 붙이지 않는다", () => {
    const r = route([{ description: "Cross the crosswalk at 10 o'clock, then walk 14m", action: "crosswalk" }]);
    expect(headedUnitText(r, [0], [{}], 2, true, tEn)).toBe("Cross the crosswalk at 10 o'clock, then walk 14m");
  });

  it("직진 스텝: 머리말을 붙인다", () => {
    const r = route([{ description: "Walk 30m along Cheonho-daero" }]);
    expect(headedUnitText(r, [0], [{}], 2, true, tEn)).toBe("Turn to 2 o'clock. Then Walk 30m along Cheonho-daero");
  });

  it("묶음도 첫 스텝으로 가른다", () => {
    const r = route([
      { description: "Turn right, then walk 5m", action: "right" },
      { description: "Turn left, then walk 40m", action: "left" },
    ]);
    expect(headedUnitText(r, [0, 1], [{}, {}], 2, true, tEn)).toBe(
      "Next instructions. Turn right, then walk 5m. Turn left, then walk 40m",
    );
  });
});

describe("ko는 종전 그대로", () => {
  it("조각 없는 횡단(판본 2 첫 스텝은 방향 구절이 없다): 머리말을 붙인다", () => {
    const r = route([{ description: "횡단보도를 건너세요. 횡단보도 길이 21m", action: "crosswalk" }]);
    expect(headedUnitText(r, [0], [{}], 2, false, tKo)).toBe("2시 방향으로 도세요. 그 후 횡단보도를 건너세요. 횡단보도 길이 21m");
  });

  it("조각 있는 회전: 머리말 + body", () => {
    const r = route([{ description: "왼쪽으로 도세요. 그 후 천호대로를 따라 39m 이동", action: "left" }]);
    expect(headedUnitText(r, [0], [{ body: "천호대로를 따라 39m 이동" }], 9, false, tKo)).toBe(
      "9시 방향으로 도세요. 그 후 천호대로를 따라 39m 이동",
    );
  });

  it("조각 없는 회전(판본 2 원문 유지 폴백): 머리말 없이 원문", () => {
    const r = route([{ description: "왼쪽으로 돌아 39m 이동", action: "left" }]);
    expect(headedUnitText(r, [0], [{}], 9, false, tKo)).toBe("왼쪽으로 돌아 39m 이동");
  });

  it("머리말 시가 없으면 원문", () => {
    const r = route([{ description: "천호대로를 따라 39m 이동" }]);
    expect(headedUnitText(r, [0], [{}], null, false, tKo)).toBe("천호대로를 따라 39m 이동");
  });
});
