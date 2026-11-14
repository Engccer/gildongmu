import { describe, expect, it } from "vitest";
import { annotateFastestRoute, type RouteMinutesSeen } from "../fastest";
import type { VergiliusToolOutcome } from "../types";

type Args = Record<string, unknown>;

const walk = (destination: string, seconds: number, args: Args = {}): VergiliusToolOutcome => ({
  call: { id: "w", name: "get_walk_route", args: { destination, ...args } },
  response: { destination, distanceMeters: 3000, durationSeconds: seconds, steps: [] },
});
const car = (destination: string, seconds: number, args: Args = {}): VergiliusToolOutcome => ({
  call: { id: "c", name: "get_car_route", args: { destination, ...args } },
  response: { destination, briefing: { distanceMeters: 4000, durationSeconds: seconds, guides: [] } },
});
const transit = (destination: string, recommended: number, alternatives: number[] = [], args: Args = {}): VergiliusToolOutcome => ({
  call: { id: "t", name: "get_transit_route", args: { destination, ...args } },
  response: {
    destination,
    route: {
      recommended: { summary: { totalMinutes: recommended } },
      alternatives: alternatives.map((m) => ({ summary: { totalMinutes: m } })),
    },
  },
});

function annotate(outcomes: VergiliusToolOutcome[], seen: RouteMinutesSeen = new Map()) {
  return annotateFastestRoute(outcomes, seen);
}

describe("annotateFastestRoute: 경로 조회 여러 수단의 가장 빠른 수단", () => {
  it("세 수단을 함께 부르면 가장 빠른 수단, 분, 비교한 수단을 세 결과에 모두 싣는다", () => {
    const out = annotate([walk("서울역", 41 * 60), transit("서울역", 10), car("서울역", 769)]);
    for (const o of out) {
      expect(o.response.fastestAmongQueried).toEqual({ modes: ["transit"], minutes: 10, compared: ["walk", "transit", "car"] });
    }
  });

  it("대중교통은 대표 경로(추천)의 분으로 잰다: 대안이 더 짧아도 [안내 시작]이 가는 경로가 기준이다", () => {
    const out = annotate([transit("서울역", 17, [10]), car("서울역", 769)]);
    expect(out[0].response.fastestAmongQueried).toEqual({ modes: ["car"], minutes: 13, compared: ["transit", "car"] });
  });

  it("도보와 자동차는 초를 들리는 분으로 바꿔 잰다(가까운 곳은 도보가 가장 빠를 수 있다)", () => {
    const out = annotate([walk("광장시장", 600), car("광장시장", 900)]);
    expect(out[0].response.fastestAmongQueried).toMatchObject({ modes: ["walk"], minutes: 10 });
  });

  it("1분 미만은 1분이다(「0분」은 들리는 값이 아니다)", () => {
    const out = annotate([walk("광장시장", 20), car("광장시장", 25)]);
    expect(out[0].response.fastestAmongQueried).toMatchObject({ modes: ["walk", "car"], minutes: 1 });
  });

  it("들리는 분이 같으면 두 수단을 함께 싣는다(초로 가르지 않는다)", () => {
    const out = annotate([transit("서울역", 13), car("서울역", 13 * 60 + 20)]);
    expect(out[0].response.fastestAmongQueried).toMatchObject({ modes: ["transit", "car"], minutes: 13 });
  });

  it("수단이 하나뿐이면 싣지 않는다", () => {
    const out = annotate([walk("서울역", 600)]);
    expect(out[0].response).not.toHaveProperty("fastestAmongQueried");
  });

  it("도착지가 다르면 비교하지 않는다", () => {
    const out = annotate([walk("서울역", 600), car("강남역", 900)]);
    for (const o of out) expect(o.response).not.toHaveProperty("fastestAmongQueried");
  });

  it("시간이 없는 결과(오류, 경로 없음, 자동차 0초=미제공)는 비교에서 빠지고 compared에도 없다", () => {
    const failed: VergiliusToolOutcome = { call: { id: "x", name: "get_transit_route", args: {} }, response: { error: "조회 실패" } };
    const noRoute: VergiliusToolOutcome = {
      call: { id: "y", name: "get_transit_route", args: {} },
      response: { destination: "서울역", route: null },
    };
    const out = annotate([failed, noRoute, walk("서울역", 2460), car("서울역", 0)]);
    for (const o of out) expect(o.response).not.toHaveProperty("fastestAmongQueried");

    const out2 = annotate([failed, walk("서울역", 2460), car("서울역", 769)]);
    const expected = { modes: ["car"], minutes: 13, compared: ["walk", "car"] };
    expect(out2[1].response.fastestAmongQueried).toEqual(expected);
    expect(out2[2].response.fastestAmongQueried).toEqual(expected);
    // 시간이 없는 결과에는 붙이지 않는다.
    expect(out2[0].response).not.toHaveProperty("fastestAmongQueried");
  });

  it("조건을 붙인 조회(경유지, 수단 한정, 계단 회피)는 수단 비교가 아니라 빠진다", () => {
    for (const conditioned of [
      walk("서울역", 600, { via: "남대문시장" }),
      walk("서울역", 600, { accessible: true }),
      transit("서울역", 5, [], { mode: "subway" }),
    ]) {
      const out = annotate([conditioned, car("서울역", 769)]);
      for (const o of out) expect(o.response).not.toHaveProperty("fastestAmongQueried");
    }
  });

  it("경로 도구가 아닌 결과는 그대로 둔다", () => {
    const bus: VergiliusToolOutcome = { call: { id: "b", name: "get_bus_arrivals", args: {} }, response: { stops: [] } };
    const out = annotate([bus, walk("서울역", 600), car("서울역", 300)]);
    expect(out[0]).toBe(bus);
  });

  it("앞 회차에 부른 수단과 함께 재고, 같은 수단을 다시 부르면 나중 결과를 쓴다(한 질문 안)", () => {
    const seen: RouteMinutesSeen = new Map();
    const first = annotate([walk("서울역", 2460)], seen);
    expect(first[0].response).not.toHaveProperty("fastestAmongQueried");
    const second = annotate([car("서울역", 769)], seen);
    expect(second[0].response.fastestAmongQueried).toEqual({ modes: ["car"], minutes: 13, compared: ["walk", "car"] });
    const third = annotate([walk("서울역", 300)], seen);
    expect(third[0].response.fastestAmongQueried).toMatchObject({ modes: ["walk"], minutes: 5 });
    // 나중 결과가 더 느려도 나중 것이다(최솟값으로 합치지 않는다).
    const fourth = annotate([walk("서울역", 1200)], seen);
    expect(fourth[0].response.fastestAmongQueried).toMatchObject({ modes: ["car"], minutes: 13 });
  });

  it("원래 응답 객체를 바꾸지 않는다", () => {
    const w = walk("서울역", 600);
    annotate([w, car("서울역", 300)]);
    expect(w.response).not.toHaveProperty("fastestAmongQueried");
  });
});
