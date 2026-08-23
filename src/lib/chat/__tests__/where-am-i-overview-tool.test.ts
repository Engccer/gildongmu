import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

const SEOUL = { lat: 37.5665, lng: 126.978 };
const TOKYO = { lat: 35.6762, lng: 139.6503 };
const YEOUIDO = { lat: 37.5219, lng: 126.9245 };

vi.mock("@/lib/where-am-i", () => ({ assembleWhereAmI: vi.fn() }));
vi.mock("@/lib/nearby-overview", () => ({ assembleNearbyOverview: vi.fn() }));
vi.mock("@/lib/providers/places", () => ({ searchPlaces: vi.fn() }));

import { executeFunction } from "../router";
import { assembleWhereAmI } from "@/lib/where-am-i";
import { assembleNearbyOverview } from "@/lib/nearby-overview";
import { searchPlaces } from "@/lib/providers/places";

const mockWhere = vi.mocked(assembleWhereAmI);
const mockOverview = vi.mocked(assembleNearbyOverview);
const mockSearch = vi.mocked(searchPlaces);

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return { locale: "ko", dataLocale: "ko", ...over };
}

const WHERE = {
  address: { road: "천중로44길 74", jibun: "길동 123" },
  region: "서울특별시 강동구 길동",
  nearestStation: { name: "길동", line: "5호선", bearing: "n" as const, distanceMeters: 400 },
  landmarks: Array.from({ length: 12 }, (_, i) => ({
    id: `k${i}`, name: `기준점${i}`, category: "cafe", categoryRaw: "음식점 > 카페", distanceMeters: i * 10, bearing: "n", lat: 0, lng: 0, link: "http://x",
  })),
};

const OVERVIEW = {
  place: "서울특별시 강동구 길동",
  radiusMeters: 1000,
  bullets: [
    { kind: "transit", state: "ok", station: null, busStops: { state: "ok", count: 3, nearest: [] } },
    { kind: "food", state: "ok", count: 15, countCapped: true, nearest: [] },
    { kind: "events", state: "unavailable", reason: "seoulOnly" },
  ],
};

describe("get_where_am_i (채팅 도구, K3 ③)", () => {
  beforeEach(() => {
    mockWhere.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockWhere.mockResolvedValue(WHERE as any);
    mockSearch.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSearch.mockResolvedValue({ places: [{ name: "여의도", ...YEOUIDO }] } as any);
  });

  it("현재 위치로 정위하고 기준점은 8개로 자른다 — 카드 없음, 출처 카카오+KRIC", async () => {
    const r = await executeFunction("get_where_am_i", {}, ctx({ userLocation: SEOUL }));
    expect(mockWhere).toHaveBeenCalledWith(SEOUL.lat, SEOUL.lng);
    const d = r.data as typeof WHERE;
    expect(d.region).toBe(WHERE.region);
    expect(d.landmarks).toHaveLength(8);
    expect(d.landmarks[0]).toEqual({ name: "기준점0", category: "음식점 > 카페", distanceMeters: 0, bearing: "n" });
    expect(r.render).toBeUndefined();
    expect(r.source).toEqual([{ label: "source.kakao" }, { label: "source.kric" }]);
  });

  it("place 지명이 있으면 지오코딩 좌표 기준(지명 > 앵커 > 현재 위치)", async () => {
    const anchor = { lat: 37.4988, lng: 127.0276, name: "강남역" };
    await executeFunction("get_where_am_i", { place: "여의도" }, ctx({ userLocation: SEOUL, placeAnchor: anchor }));
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "여의도" }));
    expect(mockWhere).toHaveBeenCalledWith(YEOUIDO.lat, YEOUIDO.lng);
  });

  it("네 조각 전부 비면 error — '주소 없는 곳'으로 위장하지 않는다", async () => {
    mockWhere.mockResolvedValue({ address: null, region: null, nearestStation: null, landmarks: [] });
    const r = await executeFunction("get_where_am_i", {}, ctx({ userLocation: SEOUL }));
    expect((r.data as { error?: string }).error).toBeTruthy();
  });

  it("좌표 없음·국외는 upstream 미호출", async () => {
    await executeFunction("get_where_am_i", {}, ctx());
    await executeFunction("get_where_am_i", {}, ctx({ userLocation: TOKYO }));
    expect(mockWhere).not.toHaveBeenCalled();
  });
});

describe("get_nearby_overview (채팅 도구, K3 ④)", () => {
  beforeEach(() => {
    mockOverview.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockOverview.mockResolvedValue({ overview: OVERVIEW, places: [] } as any);
  });

  it("조립 결과를 그대로 싣고 출처는 실린 불릿의 제공처만", async () => {
    const r = await executeFunction("get_nearby_overview", {}, ctx({ userLocation: SEOUL }));
    expect(mockOverview).toHaveBeenCalledWith(SEOUL.lat, SEOUL.lng);
    expect(r.data).toEqual(OVERVIEW);
    // 투영이 비면 카드 없음(빈 묶음에 헤딩 금지).
    expect(r.render).toBeUndefined();
    // events는 unavailable이라 인용하지 않는다(데이터를 보여준 불릿만).
    expect(r.source).toEqual([
      { label: "source.kric" },
      { label: "source.tago" },
      { label: "source.kakao" },
    ]);
  });

  it("장소 투영이 있으면 places 카드 — data엔 싣지 않고, 지명·앵커 조회에도 낸다(props-driven)", async () => {
    const place = { id: "k1", name: "길동식당", category: "음식점", address: "", roadAddress: "", lat: 37.53, lng: 127.14 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockOverview.mockResolvedValue({ overview: OVERVIEW, places: [place] } as any);
    const r = await executeFunction("get_nearby_overview", {}, ctx({ userLocation: SEOUL }));
    expect(r.render).toEqual({ type: "places", places: [place] });
    expect(r.data).toEqual(OVERVIEW);

    const anchored = await executeFunction("get_nearby_overview", {}, ctx({ userLocation: SEOUL, placeAnchor: { lat: 37.54, lng: 127.15, name: "앵커" } }));
    expect(anchored.render).toEqual({ type: "places", places: [place] });
  });

  it("버스 키 없음(busStops:null)이면 TAGO를 인용하지 않는다", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockOverview.mockResolvedValue({ overview: { ...OVERVIEW, bullets: [{ kind: "transit", state: "ok", station: null, busStops: null }] }, places: [] } as any);
    const r = await executeFunction("get_nearby_overview", {}, ctx({ userLocation: SEOUL }));
    expect(r.source).toEqual([{ label: "source.kric" }]);
  });

  it("버스 조각이 failed·none이면 TAGO를 인용하지 않는다(조각 상태는 불릿 상태와 별개)", async () => {
    for (const state of ["failed", "none", "uncovered"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockOverview.mockResolvedValue({ overview: { ...OVERVIEW, bullets: [{ kind: "transit", state: "ok", station: null, busStops: { state } }] }, places: [] } as any);
      const r = await executeFunction("get_nearby_overview", {}, ctx({ userLocation: SEOUL }));
      expect(r.source).toEqual([{ label: "source.kric" }]);
    }
  });

  it("장소 앵커가 있으면 앵커 기준", async () => {
    const anchor = { lat: 37.4988, lng: 127.0276, name: "강남역" };
    await executeFunction("get_nearby_overview", {}, ctx({ userLocation: SEOUL, placeAnchor: anchor }));
    expect(mockOverview).toHaveBeenCalledWith(anchor.lat, anchor.lng);
  });

  it("국외는 커버리지 안내만 — upstream 미호출", async () => {
    const r = await executeFunction("get_nearby_overview", {}, ctx({ userLocation: TOKYO }));
    expect(mockOverview).not.toHaveBeenCalled();
    expect((r.data as { outOfCoverage?: boolean }).outOfCoverage).toBe(true);
  });
});
