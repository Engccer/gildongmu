import { describe, expect, it } from "vitest";
import { annotateFastestRoute, type RouteMinutesSeen } from "../fastest";
import type { VergiliusToolOutcome } from "../types";

const walk = (destination: string, seconds: number): VergiliusToolOutcome => ({
  call: { id: "w", name: "get_walk_route", args: { destination } },
  response: { destination, distanceMeters: 3000, durationSeconds: seconds, steps: [] },
});
const car = (destination: string, seconds: number): VergiliusToolOutcome => ({
  call: { id: "c", name: "get_car_route", args: { destination } },
  response: { destination, briefing: { distanceMeters: 4000, durationSeconds: seconds, guides: [] } },
});
const transit = (destination: string, recommended: number, ...alternatives: number[]): VergiliusToolOutcome => ({
  call: { id: "t", name: "get_transit_route", args: { destination } },
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
  it("세 수단을 함께 부르면 가장 빠른 수단과 분을 세 결과에 모두 싣는다", () => {
    const out = annotate([walk("서울역", 41 * 60), transit("서울역", 17, 10), car("서울역", 769)]);
    for (const o of out) expect(o.response.fastestAmongQueried).toEqual({ modes: ["transit"], minutes: 10 });
  });

  it("대중교통은 추천과 대안 가운데 가장 짧은 것으로 잰다(Haiku q7: 버스 17분 추천, 자동차 13분)", () => {
    const out = annotate([transit("서울역", 17), car("서울역", 769)]);
    expect(out[0].response.fastestAmongQueried).toEqual({ modes: ["car"], minutes: 13 });
  });

  it("들리는 분이 같으면 두 수단을 함께 싣는다(초로 가르지 않는다)", () => {
    const out = annotate([transit("서울역", 13), car("서울역", 13 * 60 + 20)]);
    expect(out[0].response.fastestAmongQueried).toEqual({ modes: ["transit", "car"], minutes: 13 });
  });

  it("수단이 하나뿐이면 싣지 않는다", () => {
    const out = annotate([walk("서울역", 600)]);
    expect(out[0].response).not.toHaveProperty("fastestAmongQueried");
  });

  it("도착지가 다르면 비교하지 않는다", () => {
    const out = annotate([walk("서울역", 600), car("강남역", 900)]);
    for (const o of out) expect(o.response).not.toHaveProperty("fastestAmongQueried");
  });

  it("시간이 없는 결과(오류, 경로 없음, 자동차 0초=미제공)는 비교에서 빠지고, 남은 수단이 둘 이상일 때만 싣는다", () => {
    const failed: VergiliusToolOutcome = { call: { id: "x", name: "get_transit_route", args: {} }, response: { error: "조회 실패" } };
    const noRoute: VergiliusToolOutcome = {
      call: { id: "y", name: "get_transit_route", args: {} },
      response: { destination: "서울역", route: null },
    };
    const out = annotate([failed, noRoute, walk("서울역", 2460), car("서울역", 0)]);
    for (const o of out) expect(o.response).not.toHaveProperty("fastestAmongQueried");

    const out2 = annotate([noRoute, walk("서울역", 2460), car("서울역", 769)]);
    expect(out2[1].response.fastestAmongQueried).toEqual({ modes: ["car"], minutes: 13 });
    expect(out2[2].response.fastestAmongQueried).toEqual({ modes: ["car"], minutes: 13 });
    // 시간이 없는 결과에는 붙이지 않는다.
    expect(out2[0].response).not.toHaveProperty("fastestAmongQueried");
  });

  it("경로 도구가 아닌 결과는 그대로 둔다", () => {
    const bus: VergiliusToolOutcome = { call: { id: "b", name: "get_bus_arrivals", args: {} }, response: { stops: [] } };
    const out = annotate([bus, walk("서울역", 600), car("서울역", 300)]);
    expect(out[0]).toBe(bus);
  });

  it("앞 회차에 부른 수단과 함께 잰다(한 질문 안)", () => {
    const seen: RouteMinutesSeen = new Map();
    const first = annotate([walk("서울역", 2460)], seen);
    expect(first[0].response).not.toHaveProperty("fastestAmongQueried");
    const second = annotate([car("서울역", 769)], seen);
    expect(second[0].response.fastestAmongQueried).toEqual({ modes: ["car"], minutes: 13 });
  });

  it("원래 응답 객체를 바꾸지 않는다", () => {
    const w = walk("서울역", 600);
    annotate([w, car("서울역", 300)]);
    expect(w.response).not.toHaveProperty("fastestAmongQueried");
  });
});
