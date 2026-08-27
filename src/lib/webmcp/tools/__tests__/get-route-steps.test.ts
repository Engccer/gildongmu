import { describe, expect, it } from "vitest";
import { getRouteStepsTool } from "../get-route-steps";
import type { DirectionsBridge, ToolPlan } from "../context";

const plan = (withShortest = true): ToolPlan => ({
  planId: "P1",
  destination: "d",
  resolved: { from: "a", to: "b", via: null, avoidStairs: false },
  routeRefs: { refOf: () => null, keyOf: () => null, size: 0 },
  transit: null,
  car: { outcome: "done", steps: ["출발", "우회전"], startable: false },
  modes: ["walk", "car"],
  walk: {
    outcome: "done",
    steps: ["직진", "좌회전"],
    startable: true,
    shortest: withShortest
      ? { distanceMeters: 900, durationSeconds: 700, steps: ["최단1", "최단2", "최단3"] }
      : undefined,
  },
});
const bridge = (p: ToolPlan): DirectionsBridge => ({
  read: () => ({ fields: { from: "", to: "", via: null, avoidStairs: false }, phase: "settled", plan: p, lang: "ko" }),
  runQuery: async () => ({ kind: "busy" }),
});

describe("get_route_steps variant(W1-R #1)", () => {
  it("shortest는 최단 배열을 페이지하고 variant를 되돌려 준다", async () => {
    const out = JSON.parse(await getRouteStepsTool(bridge(plan())).execute({ planId: "P1", mode: "walk", variant: "shortest" }));
    expect(out.steps.map((s: { text: string }) => s.text)).toEqual(["최단1", "최단2", "최단3"]);
    expect(out).toMatchObject({ variant: "shortest", total: 3 });
  });
  it("기본은 recommended", async () => {
    const out = JSON.parse(await getRouteStepsTool(bridge(plan())).execute({ planId: "P1", mode: "walk" }));
    expect(out.steps.map((s: { text: string }) => s.text)).toEqual(["직진", "좌회전"]);
    expect(out.variant).toBe("recommended");
  });
  it("shortest가 없으면 unsupported{noShortest}, 자동차엔 variantWalkOnly", async () => {
    expect(JSON.parse(await getRouteStepsTool(bridge(plan(false))).execute({ planId: "P1", mode: "walk", variant: "shortest" }))).toMatchObject({ ok: false, reason: "unsupported", detail: "noShortest" });
    expect(JSON.parse(await getRouteStepsTool(bridge(plan())).execute({ planId: "P1", mode: "car", variant: "shortest" }))).toMatchObject({ ok: false, reason: "unsupported", detail: "variantWalkOnly" });
  });
});
