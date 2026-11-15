// E83 — 길찾기 세 도구의 `route-start` 렌더(spec `2026-11-14-e83-chat-route-start-design.md` §4·§5·§8).
// 신고가 없으면 결과가 종전과 같고(R2), 신고하면 경로를 찾은 때에만(R3) 렌더가 하나 나가며 `data`는 신고와 무관하게 같다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext, RouteStartRenderPayload } from "../types";

const CITY_HALL = { lat: 37.5663, lng: 126.9779 };
const CHEONHO = { lat: 37.5384, lng: 127.1237, name: "천호역", nameRoman: "Cheonho-yeok" };
const YEOUIDO = { lat: 37.5219, lng: 126.9245, name: "여의도역" };
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

const mockSearch = vi.mocked(searchPlaces);
const mockWalk = vi.mocked(getWalkRoute);
const mockCar = vi.mocked(getCarRoute);
const mockTransit = vi.mocked(getTransitRoute);

const legacyCtx: ExecutionContext = { locale: "ko", dataLocale: "ko", userLocation: CITY_HALL };
const startCtx: ExecutionContext = { ...legacyCtx, routeStart: { manualOrigin: false } };

const WALK = { distanceMeters: 3000, durationSeconds: 2400, steps: [{ description: "직진" }, { description: "도착" }] };
const CAR = { distanceMeters: 9000, durationSeconds: 900, guides: [], provider: "tmap" };
const TRANSIT_PLAIN = { recommended: { routeKey: "r0", legs: [] }, alternatives: [], totalCandidates: 1 };
const TRANSIT_FULL = { recommended: { routeKey: "r0", legs: [], stops: "있음" }, alternatives: [], totalCandidates: 1 };

/**
 * 렌더 리터럴의 키 집합(spec §4 「모든 키는 늘 있다」). 이 표가 타입과 어긋나면 컴파일이 깨지고(`satisfies`),
 * 서버가 낸 렌더의 키가 이 표와 어긋나면 아래 단언이 깨진다 — 타입 키 = 서버 리터럴 키.
 */
const RENDER_KEYS = {
  type: true,
  mode: true,
  dest: true,
  destLabel: true,
  destRoman: true,
  via: true,
  accessible: true,
  carProvider: true,
  transit: true,
} satisfies Record<keyof RouteStartRenderPayload, true>;
const TRANSIT_KEYS = {
  result: true,
  origin: true,
  queriedAt: true,
  manualOrigin: true,
} satisfies Record<keyof NonNullable<RouteStartRenderPayload["transit"]>, true>;
const sortedKeys = (o: object) => Object.keys(o).sort();

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockImplementation(async ({ query }) => ({
    places: query === "천호역" ? [CHEONHO] : query === "여의도역" ? [YEOUIDO] : query === "후쿠오카" ? [FUKUOKA] : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
  mockWalk.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockWalk.mockResolvedValue(WALK as any);
  mockCar.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockCar.mockResolvedValue(CAR as any);
  mockTransit.mockReset();
  // 옵션 없는 조회(모델용)와 화면 옵션 조회(카드용)를 가른다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockTransit.mockImplementation(async (params) => (params.includeStops ? TRANSIT_FULL : TRANSIT_PLAIN) as any);
});

describe("신고가 없으면 종전과 같다(R2)", () => {
  it("자동차: 옛 `car-route` 렌더, 경유지가 있으면 렌더 없음", async () => {
    const r = await executeFunction("get_car_route", { destination: "여의도역" }, legacyCtx);
    expect(r.render).toEqual({ type: "car-route", dest: { lat: YEOUIDO.lat, lng: YEOUIDO.lng, name: "여의도역" } });
    const withVia = await executeFunction("get_car_route", { destination: "여의도역", via: "천호역" }, legacyCtx);
    expect(withVia.render).toBeUndefined();
  });

  it("대중교통: 옛 `transit-route` 렌더, 조회는 옵션 없이 한 번", async () => {
    const r = await executeFunction("get_transit_route", { destination: "여의도역" }, legacyCtx);
    expect(r.render).toEqual({ type: "transit-route", dest: { lat: YEOUIDO.lat, lng: YEOUIDO.lng, name: "여의도역" } });
    expect(mockTransit.mock.calls).toEqual([[{ origin: CITY_HALL, dest: { lat: YEOUIDO.lat, lng: YEOUIDO.lng } }]]);
  });

  it("대중교통: 위치가 없어도 옛 렌더는 그대로 간다", async () => {
    const r = await executeFunction("get_transit_route", { destination: "여의도역" }, { locale: "ko", dataLocale: "ko" });
    expect(r.render).toEqual({ type: "transit-route", dest: { lat: YEOUIDO.lat, lng: YEOUIDO.lng, name: "여의도역" } });
  });

  it("도보: 렌더 키 자체가 없다", async () => {
    const r = await executeFunction("get_walk_route", { destination: "여의도역" }, legacyCtx);
    expect(r).not.toHaveProperty("render");
  });
});

describe("신고하면 `route-start`만 낸다", () => {
  it("도보: 도착지·계단 회피·경유지를 싣고 나머지 칸은 null·false다", async () => {
    const r = await executeFunction("get_walk_route", { destination: "여의도역", via: "천호역", accessible: true }, startCtx);
    expect(r.render).toEqual({
      type: "route-start",
      mode: "walk",
      dest: { lat: YEOUIDO.lat, lng: YEOUIDO.lng },
      destLabel: "여의도역",
      destRoman: null,
      via: { lat: CHEONHO.lat, lng: CHEONHO.lng, label: "천호역" },
      accessible: true,
      carProvider: null,
      transit: null,
    });
  });

  it("도보: 경유지·계단 회피가 없으면 via null, accessible false", async () => {
    const r = await executeFunction("get_walk_route", { destination: "여의도역" }, startCtx);
    expect(r.render).toMatchObject({ mode: "walk", via: null, accessible: false });
  });

  it("자동차: provider를 싣고 옛 `car-route`는 내지 않는다", async () => {
    const r = await executeFunction("get_car_route", { destination: "천호역" }, startCtx);
    expect(r.render).toEqual({
      type: "route-start",
      mode: "car",
      dest: { lat: CHEONHO.lat, lng: CHEONHO.lng },
      destLabel: "천호역",
      destRoman: "Cheonho-yeok",
      via: null,
      accessible: false,
      carProvider: "tmap",
      transit: null,
    });
  });

  it("자동차: 경유지가 있어도 낸다(`via` 실음, 판정 7)", async () => {
    const r = await executeFunction("get_car_route", { destination: "여의도역", via: "천호역" }, startCtx);
    expect(r.render).toMatchObject({ mode: "car", via: { lat: CHEONHO.lat, lng: CHEONHO.lng, label: "천호역" } });
  });

  it("자동차 en(NCP): provider가 없으면 carProvider null", async () => {
    const r = await executeFunction("get_car_route", { destination: "여의도역" }, { ...startCtx, locale: "en", dataLocale: "en" });
    expect(r.render).toMatchObject({ type: "route-start", mode: "car", carProvider: null });
  });

  it("대중교통: 길찾기 화면과 같은 옵션으로 받은 결과·출발 좌표·조회 시각·수동 위치 여부를 싣는다", async () => {
    const before = Date.now();
    const r = await executeFunction("get_transit_route", { destination: "여의도역" }, { ...startCtx, routeStart: { manualOrigin: true } });
    const render = r.render as RouteStartRenderPayload;
    expect(render).toMatchObject({
      type: "route-start",
      mode: "transit",
      dest: { lat: YEOUIDO.lat, lng: YEOUIDO.lng },
      destLabel: "여의도역",
      via: null,
      accessible: false,
      carProvider: null,
    });
    expect(render.transit?.result).toBe(TRANSIT_FULL);
    expect(render.transit?.origin).toEqual(CITY_HALL);
    expect(render.transit?.manualOrigin).toBe(true);
    expect(render.transit?.queriedAt).toBeGreaterThanOrEqual(before);
    expect(mockTransit.mock.calls[1][0]).toEqual({
      origin: CITY_HALL,
      dest: { lat: YEOUIDO.lat, lng: YEOUIDO.lng },
      includeStops: true,
      includeLanes: true,
      lang: "ko",
    });
  });

  it("대중교통: 카드용 조회는 데이터 언어를 따른다(en)", async () => {
    await executeFunction("get_transit_route", { destination: "여의도역" }, { ...startCtx, locale: "fr", dataLocale: "en" });
    expect(mockTransit.mock.calls[1][0]).toMatchObject({ lang: "en" });
  });

  it("세 수단의 렌더 키 집합이 타입과 같다(모든 키가 늘 있다)", async () => {
    const renders = [
      (await executeFunction("get_walk_route", { destination: "여의도역" }, startCtx)).render,
      (await executeFunction("get_car_route", { destination: "여의도역" }, startCtx)).render,
      (await executeFunction("get_car_route", { destination: "여의도역", via: "천호역" }, startCtx)).render,
      (await executeFunction("get_transit_route", { destination: "여의도역" }, startCtx)).render,
    ] as RouteStartRenderPayload[];
    for (const render of renders) {
      expect(sortedKeys(render), render.mode).toEqual(sortedKeys(RENDER_KEYS));
    }
    expect(sortedKeys(renders[3].transit!)).toEqual(sortedKeys(TRANSIT_KEYS));
  });
});

describe("모델에 주는 data는 신고와 무관하게 같다", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["get_walk_route", { destination: "여의도역" }],
    ["get_walk_route", { destination: "여의도역", via: "천호역", accessible: true }],
    ["get_car_route", { destination: "여의도역" }],
    ["get_car_route", { destination: "여의도역", via: "천호역" }],
    ["get_transit_route", { destination: "여의도역" }],
    ["get_transit_route", { destination: "여의도역", via: "천호역" }],
    ["get_walk_route", { destination: "없는곳" }],
  ];
  it.each(cases)("%s %j", async (name, args) => {
    const legacy = await executeFunction(name, args, legacyCtx);
    const reported = await executeFunction(name, args, startCtx);
    expect(JSON.stringify(reported.data)).toBe(JSON.stringify(legacy.data));
    expect(reported.source).toEqual(legacy.source);
  });
});

describe("경로를 찾은 때에만 낸다(R3)", () => {
  const noLocation: ExecutionContext = { locale: "ko", dataLocale: "ko", routeStart: { manualOrigin: false } };

  it.each(["get_walk_route", "get_car_route", "get_transit_route"])("%s: 위치가 없으면 렌더가 없다", async (name) => {
    const r = await executeFunction(name, { destination: "여의도역" }, noLocation);
    expect(r.data).toEqual({ error: "현재 위치를 알 수 없습니다." });
    expect(r.render).toBeUndefined();
  });

  it.each(["get_walk_route", "get_car_route", "get_transit_route"])("%s: 도착지를 못 찾으면 렌더가 없다", async (name) => {
    const r = await executeFunction(name, { destination: "없는곳" }, startCtx);
    expect(r.render).toBeUndefined();
  });

  it.each(["get_walk_route", "get_car_route"])("%s: 경유지를 못 찾으면 렌더가 없다", async (name) => {
    const r = await executeFunction(name, { destination: "여의도역", via: "없는곳" }, startCtx);
    expect(r.render).toBeUndefined();
  });

  it.each(["get_walk_route", "get_car_route", "get_transit_route"])("%s: 출발 위치가 한국 밖이면 렌더가 없다", async (name) => {
    const r = await executeFunction(name, { destination: "여의도역" }, { ...startCtx, userLocation: FUKUOKA });
    expect(r.data).toMatchObject({ outOfCoverage: true });
    expect(r.render).toBeUndefined();
  });

  it("도보: 경로 없음(briefing null)이면 렌더가 없다", async () => {
    mockWalk.mockResolvedValue(null);
    const r = await executeFunction("get_walk_route", { destination: "여의도역" }, startCtx);
    expect(r.data).toEqual({ destination: "여의도역", briefing: null });
    expect(r.render).toBeUndefined();
  });

  it("도보·자동차: 조회 실패(throw)는 그대로 던진다 — 루프가 오류 결과로 감싸고 렌더는 없다", async () => {
    mockWalk.mockRejectedValue(new Error("upstream"));
    mockCar.mockRejectedValue(new Error("upstream"));
    await expect(executeFunction("get_walk_route", { destination: "여의도역" }, startCtx)).rejects.toThrow();
    await expect(executeFunction("get_car_route", { destination: "여의도역" }, startCtx)).rejects.toThrow();
  });

  it("대중교통: 경로 없음(null)이면 렌더가 없고 카드용 조회도 하지 않는다", async () => {
    mockTransit.mockResolvedValue(null);
    const r = await executeFunction("get_transit_route", { destination: "여의도역" }, startCtx);
    expect(r.data).toEqual({ destination: "여의도역", route: null });
    expect(r.render).toBeUndefined();
    expect(mockTransit).toHaveBeenCalledTimes(1);
  });

  it("대중교통: 경유지 미지원 마커에는 렌더가 없고 조회하지 않는다", async () => {
    const r = await executeFunction("get_transit_route", { destination: "여의도역", via: "천호역" }, startCtx);
    expect(r.data).toMatchObject({ route: null, unsupported: "waypoint" });
    expect(r.render).toBeUndefined();
    expect(mockTransit).not.toHaveBeenCalled();
  });

  it("자동차 en: 경유지 미지원 마커에는 렌더가 없다", async () => {
    const r = await executeFunction(
      "get_car_route",
      { destination: "여의도역", via: "천호역" },
      { ...startCtx, locale: "en", dataLocale: "en" },
    );
    expect(r.data).toMatchObject({ briefing: null, unsupported: "waypoint" });
    expect(r.render).toBeUndefined();
  });

  it("대중교통: 카드용 조회만 실패하면 답은 그대로이고 렌더만 없다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockTransit.mockImplementation(async (params) => {
      if (params.includeStops) throw new Error("upstream");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return TRANSIT_PLAIN as any;
    });
    const r = await executeFunction("get_transit_route", { destination: "여의도역" }, startCtx);
    expect(r.data).toEqual({ destination: "여의도역", route: TRANSIT_PLAIN });
    expect(r.render).toBeUndefined();
  });

  it("대중교통: 카드용 조회가 경로 없음이면 렌더가 없다", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransit.mockImplementation(async (params) => (params.includeStops ? null : TRANSIT_PLAIN) as any);
    const r = await executeFunction("get_transit_route", { destination: "여의도역" }, startCtx);
    expect(r.render).toBeUndefined();
  });
});
