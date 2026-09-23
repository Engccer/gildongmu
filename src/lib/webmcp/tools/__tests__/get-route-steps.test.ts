import { afterEach, describe, expect, it } from "vitest";
import { getRouteStepsTool } from "../get-route-steps";
import { __resetViewRegistryForTest, publishView } from "../../view-registry";
afterEach(__resetViewRegistryForTest);
/** 레지스트리에 게시한 브릿지로 도구를 만든다(도구는 실행 시점에 registry를 읽는다). */
function tool(b: DirectionsBridge) {
  __resetViewRegistryForTest();
  publishView("directions", b);
  return getRouteStepsTool();
}
import type { DirectionsBridge, ToolPlan } from "../context";

const plan = (withSecond = true): ToolPlan => ({
  planId: "P1",
  destination: "d",
  resolved: { from: "a", to: "b", via: null },
  routeRefs: { refOf: () => null, keyOf: () => null, size: 0 },
  transit: null,
  car: { outcome: "done", steps: ["출발", "우회전"], startable: false },
  modes: ["walk", "car"],
  walk: {
    outcome: "done",
    startable: true,
    lines: [
      { kind: "shortest", label: "최단 경로, 총 900m, 약 12분", distanceMeters: 900, durationSeconds: 700, steps: ["최단1", "최단2", "최단3"] },
      ...(withSecond
        ? [{ kind: "accessible" as const, label: "계단 회피 경로, 총 950m, 약 13분", distanceMeters: 950, durationSeconds: 760, steps: ["직진", "좌회전"] }]
        : []),
    ],
  },
});
const bridge = (p: ToolPlan): DirectionsBridge => ({
  read: () => ({ fields: { from: "", to: "", via: null }, phase: "settled", plan: p, lang: "ko" }),
  runQuery: async () => ({ kind: "busy" }),
});

describe("get_route_steps variant = 줄 종류(E42)", () => {
  it("variant로 고른 줄의 배열을 페이지하고 variant를 되돌려 준다", async () => {
    const out = JSON.parse(await tool(bridge(plan())).execute({ planId: "P1", mode: "walk", variant: "accessible" }));
    expect(out.steps.map((s: { text: string }) => s.text)).toEqual(["직진", "좌회전"]);
    expect(out).toMatchObject({ variant: "accessible", total: 2 });
  });
  it("기본은 첫 줄(화면 기본 펼침)", async () => {
    const out = JSON.parse(await tool(bridge(plan())).execute({ planId: "P1", mode: "walk" }));
    expect(out.steps.map((s: { text: string }) => s.text)).toEqual(["최단1", "최단2", "최단3"]);
    expect(out.variant).toBe("shortest");
  });
  it("계획에 없는 줄은 unsupported{noLine}, 자동차엔 variantWalkOnly", async () => {
    expect(JSON.parse(await tool(bridge(plan(false))).execute({ planId: "P1", mode: "walk", variant: "accessible" }))).toMatchObject({ ok: false, reason: "unsupported", detail: "noLine" });
    expect(JSON.parse(await tool(bridge(plan())).execute({ planId: "P1", mode: "car", variant: "shortest" }))).toMatchObject({ ok: false, reason: "unsupported", detail: "variantWalkOnly" });
  });
  it("자동차는 variant 없이 자기 스텝", async () => {
    const out = JSON.parse(await tool(bridge(plan())).execute({ planId: "P1", mode: "car" }));
    expect(out.steps.map((s: { text: string }) => s.text)).toEqual(["출발", "우회전"]);
    expect("variant" in out).toBe(false);
  });
  it("길찾기 뷰가 없으면 noResult{noDirectionsView}", async () => {
    __resetViewRegistryForTest();
    expect(JSON.parse(await getRouteStepsTool().execute({ planId: "P1", mode: "walk" }))).toMatchObject({ ok: false, reason: "noResult", detail: "noDirectionsView" });
  });
});
