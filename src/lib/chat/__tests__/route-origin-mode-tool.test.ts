// E88 묶음 ⓐ — 길찾기 세 도구의 말한 출발지(`origin`)와 대중교통 수단 한정(`mode`).
// spec `docs/superpowers/specs/2026-11-14-e88-chat-tool-gaps-design.md` A1·A2.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

const GILDONG = { lat: 37.5378, lng: 127.1417 };
const SEOUL_STATION = { lat: 37.5547, lng: 126.9707, name: "서울역", roadAddress: "서울 용산구 한강대로 405" };
const GYEONGBOK = { lat: 37.5796, lng: 126.977, name: "경복궁", nameRoman: "Gyeongbokgung" };
const CHEONHO = { lat: 37.5384, lng: 127.1237, name: "천호역" };
const FUKUOKA = { lat: 33.5902, lng: 130.4017, name: "후쿠오카" };

vi.mock("@/lib/providers/places", () => ({ searchPlaces: vi.fn() }));
vi.mock("@/lib/walk-route", () => ({ getWalkRoute: vi.fn() }));
vi.mock("@/lib/car-route", () => ({ getCarRoute: vi.fn() }));
vi.mock("@/lib/providers/odsay", () => ({ getTransitRoute: vi.fn() }));
vi.mock("@/lib/env", async (orig) => ({
  ...(await orig<typeof import("@/lib/env")>()),
  hasWalkRouteKey: () => true,
  hasNcpMapsKeys: () => true,
}));
vi.mock("@/lib/providers/ncp-directions", () => ({
  getCarRouteBriefingEn: vi.fn(async () => ({ distanceMeters: 1, durationSeconds: 1, guides: [] })),
}));

import { executeFunction } from "../router";
import { searchPlaces } from "@/lib/providers/places";
import { getWalkRoute } from "@/lib/walk-route";
import { getCarRoute } from "@/lib/car-route";
import { getTransitRoute } from "@/lib/providers/odsay";
import { getCarRouteBriefingEn } from "@/lib/providers/ncp-directions";

const mockSearch = vi.mocked(searchPlaces);
const mockWalk = vi.mocked(getWalkRoute);
const mockCar = vi.mocked(getCarRoute);
const mockTransit = vi.mocked(getTransitRoute);

const legacyCtx: ExecutionContext = { locale: "ko", dataLocale: "ko", userLocation: GILDONG };
const startCtx: ExecutionContext = { ...legacyCtx, routeStart: { manualOrigin: false } };
const noLocationCtx: ExecutionContext = { locale: "ko", dataLocale: "ko" };
const anchorCtx: ExecutionContext = { ...legacyCtx, placeAnchor: { ...CHEONHO } };

const WALK = { distanceMeters: 3000, durationSeconds: 2400, steps: [{ description: "직진" }, { description: "도착" }] };
const CAR = { distanceMeters: 9000, durationSeconds: 900, guides: [], provider: "tmap" };
const TRANSIT = { recommended: { routeKey: "r0", legs: [] }, alternatives: [], totalCandidates: 1 };
const SUBWAY_ONLY = { recommended: { routeKey: "s0", legs: [] }, alternatives: [], totalCandidates: 2 };

const ROUTE_TOOLS = ["get_walk_route", "get_car_route", "get_transit_route"] as const;
const ORIGIN_LABEL = "서울역 (서울 용산구 한강대로 405)";

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockImplementation(async ({ query }) => ({
    places:
      query === "서울역" ? [SEOUL_STATION]
      : query === "경복궁" ? [GYEONGBOK]
      : query === "천호역" ? [CHEONHO]
      : query === "후쿠오카" ? [FUKUOKA]
      : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
  mockWalk.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockWalk.mockResolvedValue(WALK as any);
  mockCar.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockCar.mockResolvedValue(CAR as any);
  mockTransit.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockTransit.mockImplementation(async (params) => (params.modeAxis === "subwayOnly" ? SUBWAY_ONLY : params.modeAxis ? null : TRANSIT) as any);
});

/** 그 도구가 provider에 넘긴 출발지. */
function originPassed(tool: (typeof ROUTE_TOOLS)[number]) {
  const mock = tool === "get_walk_route" ? mockWalk : tool === "get_car_route" ? mockCar : mockTransit;
  return mock.mock.calls[0][0].origin;
}

describe("말한 출발지(A1)", () => {
  it.each(ROUTE_TOOLS)("%s: 말한 출발지의 좌표로 조회하고 실제로 고른 장소를 data.origin에 싣는다", async (tool) => {
    const r = await executeFunction(tool, { destination: "경복궁", origin: "서울역" }, legacyCtx);
    expect(originPassed(tool)).toEqual({ lat: SEOUL_STATION.lat, lng: SEOUL_STATION.lng });
    expect(r.data.origin).toBe(ORIGIN_LABEL);
    expect(r.data.destination).toBe("경복궁");
  });

  it.each(ROUTE_TOOLS)("%s: 렌더를 내지 않는다 — 신고한 요청의 route-start도, 신고하지 않은 요청의 종전 카드도", async (tool) => {
    const started = await executeFunction(tool, { destination: "경복궁", origin: "서울역" }, startCtx);
    expect(started.render).toBeUndefined();
    const legacy = await executeFunction(tool, { destination: "경복궁", origin: "서울역" }, legacyCtx);
    expect(legacy.render).toBeUndefined();
  });

  it("대중교통: 말한 출발지의 답에는 카드용 조회(유료)를 하지 않는다", async () => {
    await executeFunction("get_transit_route", { destination: "경복궁", origin: "서울역" }, startCtx);
    expect(mockTransit).toHaveBeenCalledTimes(1);
    expect(mockTransit.mock.calls[0][0].includeStops).toBeUndefined();
  });

  it.each(ROUTE_TOOLS)("%s: 출발지를 못 풀면 placeNotFound이고 현재 위치로 조회하지 않는다", async (tool) => {
    const r = await executeFunction(tool, { destination: "경복궁", origin: "없는곳" }, startCtx);
    expect(r.data).toEqual({ error: "'없는곳' 위치를 찾지 못했습니다." });
    expect(r.render).toBeUndefined();
    expect(mockWalk).not.toHaveBeenCalled();
    expect(mockCar).not.toHaveBeenCalled();
    expect(mockTransit).not.toHaveBeenCalled();
  });

  it.each(ROUTE_TOOLS)("%s: 위치 권한이 없어도 말한 출발지로 조회한다", async (tool) => {
    const r = await executeFunction(tool, { destination: "경복궁", origin: "서울역" }, noLocationCtx);
    expect(r.data.error).toBeUndefined();
    expect(originPassed(tool)).toEqual({ lat: SEOUL_STATION.lat, lng: SEOUL_STATION.lng });
  });

  it.each(ROUTE_TOOLS)("%s: 장소 채팅에서도 말한 출발지가 실제 위치보다 우선이고, 앵커는 출발지가 되지 않는다", async (tool) => {
    await executeFunction(tool, { destination: "경복궁", origin: "서울역" }, anchorCtx);
    expect(originPassed(tool)).toEqual({ lat: SEOUL_STATION.lat, lng: SEOUL_STATION.lng });
    mockWalk.mockClear();
    mockCar.mockClear();
    mockTransit.mockClear();
    await executeFunction(tool, { destination: "경복궁" }, anchorCtx);
    expect(originPassed(tool)).toEqual(GILDONG);
  });

  it.each(ROUTE_TOOLS)("%s: 출발지가 한국 밖이면 커버리지 안내만 돌려주고 조회하지 않는다", async (tool) => {
    const r = await executeFunction(tool, { destination: "경복궁", origin: "후쿠오카" }, legacyCtx);
    expect(r.data.outOfCoverage).toBe(true);
    // 리뷰 S2: 고른 장소를 싣고, 「현재 위치」가 한국 밖이라는 종전 문장을 쓰지 않는다(사용자는 서울에 있다).
    expect(r.data.origin).toBe("후쿠오카");
    expect(String(r.data.notice)).toContain("말한 출발지");
    expect(String(r.data.notice)).not.toContain("현재 위치");
    expect(mockWalk).not.toHaveBeenCalled();
    expect(mockCar).not.toHaveBeenCalled();
    expect(mockTransit).not.toHaveBeenCalled();
  });

  it.each(ROUTE_TOOLS)("%s: 빈 문자열·문자열 아닌 origin은 없는 것으로 본다(현재 위치 출발, origin 키 없음)", async (tool) => {
    for (const origin of ["", "  ", 3, null]) {
      mockWalk.mockClear();
      mockCar.mockClear();
      mockTransit.mockClear();
      const r = await executeFunction(tool, { destination: "경복궁", origin }, legacyCtx);
      expect(originPassed(tool)).toEqual(GILDONG);
      expect("origin" in r.data).toBe(false);
    }
  });

  it("도보: 경유지·계단 회피와 함께 쓸 수 있다", async () => {
    const r = await executeFunction(
      "get_walk_route",
      { destination: "경복궁", origin: "서울역", via: "천호역", accessible: true },
      startCtx,
    );
    const passed = mockWalk.mock.calls[0][0];
    expect(passed.origin).toEqual({ lat: SEOUL_STATION.lat, lng: SEOUL_STATION.lng });
    expect(passed.via).toEqual({ name: "천호역", lat: CHEONHO.lat, lng: CHEONHO.lng });
    expect(passed.accessible).toBe(true);
    expect(r.render).toBeUndefined();
  });

  it("자동차: 경유지와 함께 쓸 수 있다(리뷰 S5)", async () => {
    await executeFunction("get_car_route", { destination: "경복궁", origin: "서울역", via: "천호역" }, legacyCtx);
    expect(mockCar.mock.calls[0][0]).toEqual({
      origin: { lat: SEOUL_STATION.lat, lng: SEOUL_STATION.lng },
      dest: { lat: GYEONGBOK.lat, lng: GYEONGBOK.lng },
      via: { name: "천호역", lat: CHEONHO.lat, lng: CHEONHO.lng },
    });
  });

  it("자동차 en: 말한 출발지가 영어 경로 조회에도 넘어간다(리뷰 S5)", async () => {
    const enCtx: ExecutionContext = { ...legacyCtx, locale: "en", dataLocale: "en" };
    const r = await executeFunction("get_car_route", { destination: "경복궁", origin: "서울역" }, enCtx);
    expect(vi.mocked(getCarRouteBriefingEn).mock.lastCall?.[0]).toEqual({
      origin: { lat: SEOUL_STATION.lat, lng: SEOUL_STATION.lng },
      dest: { lat: GYEONGBOK.lat, lng: GYEONGBOK.lng },
    });
    expect(r.data.origin).toBe(ORIGIN_LABEL);
    expect(mockCar).not.toHaveBeenCalled();
  });

  it("경유지 미지원(대중교통, 자동차 en)은 출발지 해석보다 먼저 판정한다 — 출발지를 검색하지 않는다(리뷰 S4)", async () => {
    const transit = await executeFunction("get_transit_route", { destination: "경복궁", origin: "없는곳", via: "천호역" }, legacyCtx);
    expect(transit.data.unsupported).toBe("waypoint");
    const enCtx: ExecutionContext = { ...legacyCtx, locale: "en", dataLocale: "en" };
    const car = await executeFunction("get_car_route", { destination: "경복궁", origin: "없는곳", via: "천호역" }, enCtx);
    expect(car.data.unsupported).toBe("waypoint");
    expect(mockSearch.mock.calls.map(([q]) => q.query)).not.toContain("없는곳");
    expect(mockTransit).not.toHaveBeenCalled();
  });

  it("도보: 경로 없음에도 출발지를 싣는다", async () => {
    mockWalk.mockResolvedValue(null);
    const r = await executeFunction("get_walk_route", { destination: "경복궁", origin: "서울역" }, legacyCtx);
    expect(r.data).toEqual({ destination: "경복궁", origin: ORIGIN_LABEL, briefing: null });
  });
});

describe("출발지를 말하지 않으면 응답이 종전과 같다(A1)", () => {
  it("도보: data의 키와 순서가 그대로다", async () => {
    const r = await executeFunction("get_walk_route", { destination: "경복궁" }, legacyCtx);
    expect(JSON.stringify(r.data)).toBe(
      JSON.stringify({ destination: "경복궁", distanceMeters: 3000, durationSeconds: 2400, steps: WALK.steps }),
    );
    expect(r.render).toBeUndefined();
  });

  it("자동차: data와 종전 카드가 그대로다", async () => {
    const r = await executeFunction("get_car_route", { destination: "경복궁" }, legacyCtx);
    expect(JSON.stringify(r.data)).toBe(JSON.stringify({ destination: "경복궁", briefing: CAR }));
    expect(r.render).toEqual({ type: "car-route", dest: { lat: GYEONGBOK.lat, lng: GYEONGBOK.lng, name: "경복궁" } });
    expect(mockCar.mock.calls[0][0]).toEqual({ origin: GILDONG, dest: { lat: GYEONGBOK.lat, lng: GYEONGBOK.lng }, via: undefined });
  });

  it("대중교통: data·종전 카드·provider 인자가 그대로다(수단 축 키가 없다)", async () => {
    const r = await executeFunction("get_transit_route", { destination: "경복궁" }, legacyCtx);
    expect(JSON.stringify(r.data)).toBe(JSON.stringify({ destination: "경복궁", route: TRANSIT }));
    expect(r.render).toEqual({ type: "transit-route", dest: { lat: GYEONGBOK.lat, lng: GYEONGBOK.lng, name: "경복궁" } });
    expect(mockTransit.mock.calls[0][0]).toEqual({ origin: GILDONG, dest: { lat: GYEONGBOK.lat, lng: GYEONGBOK.lng } });
  });

  it("대중교통: 경로 없음은 route:null뿐이다(수단 한정 표식이 붙지 않는다)", async () => {
    mockTransit.mockResolvedValue(null);
    const r = await executeFunction("get_transit_route", { destination: "경복궁" }, legacyCtx);
    expect(r.data).toEqual({ destination: "경복궁", route: null });
  });
});

describe("대중교통 수단 한정(A2)", () => {
  it("지하철만: provider에 수단 축을 넘기고 한정한 수단을 data.mode에 싣는다", async () => {
    const r = await executeFunction("get_transit_route", { destination: "경복궁", mode: "subway" }, legacyCtx);
    expect(mockTransit.mock.calls[0][0]).toEqual({
      origin: GILDONG,
      dest: { lat: GYEONGBOK.lat, lng: GYEONGBOK.lng },
      modeAxis: "subwayOnly",
    });
    expect(r.data).toEqual({ destination: "경복궁", mode: "subway", route: SUBWAY_ONLY });
  });

  it("버스만 가는 경로가 없으면 noRouteWithMode로 가른다(route:null만 주지 않는다)", async () => {
    const r = await executeFunction("get_transit_route", { destination: "경복궁", mode: "bus" }, legacyCtx);
    expect(mockTransit.mock.calls[0][0].modeAxis).toBe("busOnly");
    expect(r.data.route).toBeNull();
    expect(r.data.mode).toBe("bus");
    expect(r.data.noRouteWithMode).toBe(true);
    // 리뷰 S1: 다른 경로가 있다고 단정하지 않는다(provider null은 「너무 가까움」도 겹쳐 든다).
    expect(String(r.data.notice)).toContain("경로가 있을 수 있습니다");
  });

  it("조회 실패는 던진다(0건과 다른 상태)", async () => {
    mockTransit.mockRejectedValue(new Error("ODsay 500"));
    await expect(executeFunction("get_transit_route", { destination: "경복궁", mode: "bus" }, legacyCtx)).rejects.toThrow("ODsay 500");
  });

  it("모르는 값은 한정 없이 조회한다", async () => {
    const r = await executeFunction("get_transit_route", { destination: "경복궁", mode: "taxi" }, legacyCtx);
    expect(mockTransit.mock.calls[0][0].modeAxis).toBeUndefined();
    expect(r.data).toEqual({ destination: "경복궁", route: TRANSIT });
  });

  it("신고하지 않은 요청: 종전 카드는 수단을 모르는 채 다시 조회하므로 내지 않는다", async () => {
    const r = await executeFunction("get_transit_route", { destination: "경복궁", mode: "subway" }, legacyCtx);
    expect(r.render).toBeUndefined();
  });

  it("신고한 요청: 카드도 같은 수단 축으로 받은 결과를 싣는다", async () => {
    const r = await executeFunction("get_transit_route", { destination: "경복궁", mode: "subway" }, startCtx);
    expect(mockTransit).toHaveBeenCalledTimes(2);
    expect(mockTransit.mock.calls[1][0]).toMatchObject({ modeAxis: "subwayOnly", includeStops: true, includeLanes: true });
    expect(r.render).toMatchObject({ type: "route-start", mode: "transit", transit: { result: SUBWAY_ONLY } });
  });

  it("신고한 요청: 그 수단의 경로가 없으면 카드도 카드용 조회도 없다", async () => {
    const r = await executeFunction("get_transit_route", { destination: "경복궁", mode: "bus" }, startCtx);
    expect(mockTransit).toHaveBeenCalledTimes(1);
    expect(r.render).toBeUndefined();
  });

  it("출발지와 함께: 말한 출발지에서 그 수단만으로 조회한다", async () => {
    const r = await executeFunction("get_transit_route", { destination: "경복궁", origin: "서울역", mode: "subway" }, startCtx);
    expect(mockTransit.mock.calls[0][0]).toEqual({
      origin: { lat: SEOUL_STATION.lat, lng: SEOUL_STATION.lng },
      dest: { lat: GYEONGBOK.lat, lng: GYEONGBOK.lng },
      modeAxis: "subwayOnly",
    });
    expect(r.data).toEqual({ destination: "경복궁", origin: ORIGIN_LABEL, mode: "subway", route: SUBWAY_ONLY });
    expect(r.render).toBeUndefined();
  });
});
