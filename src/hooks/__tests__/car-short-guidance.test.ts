import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import type { GuideRoute } from "@/lib/route-guide";
import type { CarLandmark } from "@/lib/route-geometry";
import type { GuideAction } from "@/lib/walk-action";
import { carImminentLine, carPeriodicLine } from "../useRouteGuide";

/**
 * 자동차 짧은 안내(임박·주기)의 지점·방면(E61). 기대 문장은 문안 확정본
 * `docs/superpowers/specs/2026-10-03-guidance-wording-confirmed.md` 바·사를 그대로 옮긴 것이다.
 */

type GuideT = Parameters<typeof carImminentLine>[2];
const tKo = createTranslator({ locale: "ko", messages: ko, namespace: "guide" }) as unknown as GuideT;
const tEn = createTranslator({ locale: "en", messages: en, namespace: "guide" }) as unknown as GuideT;

describe("임박 문장 (문안 바)", () => {
  it("지점과 방면 모두 있음", () => {
    expect(carImminentLine("right", { at: "광진교남단", toward: "천호 사거리" }, tKo, false)).toBe(
      "잠시 후 광진교남단에서 천호 사거리 방면으로 우회전하세요",
    );
  });
  it("지점만 있음", () => {
    expect(carImminentLine("keepLeft", { at: "천호대교북단" }, tKo, false)).toBe(
      "잠시 후 천호대교북단에서 왼쪽 길로 가세요",
    );
  });
  it("방면만 있음", () => {
    expect(carImminentLine("keepRight", { toward: "구리타워" }, tKo, false)).toBe(
      "잠시 후 구리타워 방면으로 오른쪽 길로 가세요",
    );
  });
  it("이름 없이 \"교차로\"뿐(서버가 지점을 뺀다 — 스텝에 없음)", () => {
    expect(carImminentLine("right", undefined, tKo, false)).toBe("잠시 후 우회전하세요");
  });
  it("en 화면은 한글 이름을 빼고 종전 문장", () => {
    expect(carImminentLine("right", { at: "광진교남단", toward: "천호 사거리" }, tEn, true)).toBe(
      "Turn right shortly",
    );
  });
  it("en 화면의 라틴 이름은 남는다", () => {
    expect(carImminentLine("right", { at: "COEX" }, tEn, true)).toBe("Shortly, at COEX, turn right");
  });
});

function routeOf(...steps: { action?: GuideAction; carLandmark?: CarLandmark }[]): GuideRoute {
  return {
    steps: steps.map((s, index) => ({ index, description: `스텝 ${index}`, ...s })),
  } as unknown as GuideRoute;
}

describe("주기 문장 (문안 사)", () => {
  it("지점 있음 — 방면은 싣지 않는다", () => {
    const route = routeOf({}, { action: "right", carLandmark: { at: "광진교남단", toward: "천호 사거리" } });
    expect(carPeriodicLine(route, 0, "목적지", "147m", tKo, false)).toBe("147m 직진하다가 광진교남단에서 우회전");
  });
  it("지점 없음", () => {
    const route = routeOf({}, { action: "right", carLandmark: { toward: "천호 사거리" } });
    expect(carPeriodicLine(route, 0, "목적지", "147m", tKo, false)).toBe("147m 직진하다가 우회전");
    expect(carPeriodicLine(routeOf({}, { action: "right" }), 0, "목적지", "147m", tKo, false)).toBe(
      "147m 직진하다가 우회전",
    );
  });
  it("en 화면은 한글 지점을 뺀 종전 문장", () => {
    const route = routeOf({}, { action: "right", carLandmark: { at: "광진교남단" } });
    expect(carPeriodicLine(route, 0, "Home", "147 m", tEn, true)).toBe("Turn right in 147 m");
  });
});

describe("시작 문장 (문안 라 넷째 줄)", () => {
  it("할 일 먼저, 요약은 뒤에 이름표 없이", () => {
    expect(
      tKo("carStart", { dest: "목적지", first: "올림픽로를 따라 500m 이동", count: 8, distance: "5.2km" }),
    ).toBe("목적지까지 자동차 안내 시작. 올림픽로를 따라 500m 이동. 안내 8개, 총 5.2km.");
  });
});
