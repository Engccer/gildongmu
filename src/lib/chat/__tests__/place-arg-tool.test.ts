// K3 ②⑥ — 앵커 고정 8도구의 `place` 인자 + get_subway_arrivals의 `stationName` 인자.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

const HOME = { lat: 37.5378, lng: 127.1417 };
const ANCHOR = { lat: 37.4988, lng: 127.0276, name: "강남역" };
const YEOUIDO = { lat: 37.5219, lng: 126.9245 };
const OSAKA = { lat: 34.6937, lng: 135.5023 };

vi.mock("@/lib/providers/places", () => ({ searchPlaces: vi.fn() }));
vi.mock("@/lib/providers/subway-nearby", () => ({
  fetchNearbySubwayArrivals: vi.fn(async () => []),
  findNearestStationInfo: vi.fn(() => null),
}));
vi.mock("@/lib/providers/seoul-subway-arrival", () => ({ fetchSubwayArrivals: vi.fn() }));
vi.mock("@/lib/clinics", () => ({
  findNightClinicsNow: vi.fn(async () => ({ clinics: [], total: 0, basis: "weekday" })),
}));
vi.mock("@/lib/providers/tour-barrier-free", () => ({
  searchBarrierFreeNearby: vi.fn(async () => []),
  getBarrierFreeDetail: vi.fn(),
}));
vi.mock("@/lib/providers/kids-places", () => ({ findKidsPlacesNear: vi.fn(async () => []) }));
vi.mock("@/lib/culture-events", () => ({
  findEventsNear: vi.fn(async () => ({ events: [], total: 0 })),
  isEventServiceArea: vi.fn(() => true),
}));
vi.mock("@/lib/congestion", () => ({ findCongestionNear: vi.fn(async () => ({ area: null })) }));
vi.mock("@/lib/providers/surroundings", () => ({ findSurroundingsNear: vi.fn(async () => []) }));
vi.mock("@/lib/walk-infra", () => ({
  getWalkInfrastructure: vi.fn(async () => ({ audioSignals: { status: "ok" }, osm: { status: "ok" } })),
}));

import { executeFunction } from "../router";
import { searchPlaces } from "@/lib/providers/places";
import { fetchNearbySubwayArrivals } from "@/lib/providers/subway-nearby";
import { fetchSubwayArrivals } from "@/lib/providers/seoul-subway-arrival";
import { findNightClinicsNow } from "@/lib/clinics";
import { searchBarrierFreeNearby } from "@/lib/providers/tour-barrier-free";
import { findKidsPlacesNear } from "@/lib/providers/kids-places";
import { findEventsNear } from "@/lib/culture-events";
import { findCongestionNear } from "@/lib/congestion";
import { findSurroundingsNear } from "@/lib/providers/surroundings";
import { getWalkInfrastructure } from "@/lib/walk-infra";

const mockSearch = vi.mocked(searchPlaces);

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return { locale: "ko", dataLocale: "ko", ...over };
}

/** 도구 이름 → 좌표를 받는 provider mock(호출 인자 첫 둘이 lat·lng). */
const TOOLS: [string, ReturnType<typeof vi.fn>][] = [
  ["get_subway_arrivals", vi.mocked(fetchNearbySubwayArrivals)],
  ["get_night_clinics", vi.mocked(findNightClinicsNow)],
  ["get_nearby_barrier_free", vi.mocked(searchBarrierFreeNearby)],
  ["get_kids_places", vi.mocked(findKidsPlacesNear)],
  ["get_nearby_events", vi.mocked(findEventsNear)],
  ["get_congestion", vi.mocked(findCongestionNear)],
  ["get_surroundings", vi.mocked(findSurroundingsNear)],
  ["get_walk_infrastructure", vi.mocked(getWalkInfrastructure)],
];

/** 카드를 내던 도구 5종 — place·앵커 조회에선 카드가 빠져야 한다(기기 위치 self-fetch). */
const CARDED = ["get_subway_arrivals", "get_night_clinics", "get_nearby_barrier_free", "get_kids_places", "get_surroundings"];

describe("앵커 고정 8도구의 place 인자 (K3 ⑥)", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSearch.mockResolvedValue({ places: [{ name: "여의도역", roadAddress: "서울 영등포구 여의나루로 지하 40", ...YEOUIDO }] } as any);
    for (const [, m] of TOOLS) m.mockClear();
  });

  for (const [name, mock] of TOOLS) {
    it(`${name}: place > 앵커 > 현재 위치 순서로 좌표를 고른다`, async () => {
      await executeFunction(name, { place: "여의도" }, ctx({ userLocation: HOME, placeAnchor: ANCHOR }));
      expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "여의도" }));
      expect(mock.mock.calls[0][0]).toBe(YEOUIDO.lat);
      expect(mock.mock.calls[0][1]).toBe(YEOUIDO.lng);

      mock.mockClear();
      await executeFunction(name, {}, ctx({ userLocation: HOME, placeAnchor: ANCHOR }));
      expect(mock.mock.calls[0][0]).toBe(ANCHOR.lat);

      mock.mockClear();
      await executeFunction(name, {}, ctx({ userLocation: HOME }));
      expect(mock.mock.calls[0][0]).toBe(HOME.lat);
    });

    it(`${name}: 지명을 못 찾으면 현재 위치로 대체하지 않는다`, async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockSearch.mockResolvedValue({ places: [] } as any);
      const r = await executeFunction(name, { place: "없는지명" }, ctx({ userLocation: HOME }));
      expect(mock).not.toHaveBeenCalled();
      expect((r.data as { error?: string }).error).toContain("없는지명");
    });

    it(`${name}: 해외 지명은 커버리지 안내 — provider 미호출`, async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockSearch.mockResolvedValue({ places: [{ name: "오사카", ...OSAKA }] } as any);
      const r = await executeFunction(name, { place: "오사카" }, ctx({ userLocation: HOME }));
      expect(mock).not.toHaveBeenCalled();
      expect((r.data as { outOfCoverage?: boolean }).outOfCoverage).toBe(true);
    });
  }

  it("지명 조회는 해석된 장소를 resolvedPlace로 되돌린다(키워드 1위가 지명과 어긋날 수 있다)", async () => {
    const r = await executeFunction("get_congestion", { place: "여의도" }, ctx({ userLocation: HOME }));
    expect((r.data as { resolvedPlace?: string }).resolvedPlace).toBe("여의도역 (서울 영등포구 여의나루로 지하 40)");
    const cur = await executeFunction("get_congestion", {}, ctx({ userLocation: HOME }));
    expect((cur.data as { resolvedPlace?: string }).resolvedPlace).toBeUndefined();
  });

  for (const name of CARDED) {
    it(`${name}: place 조회는 카드를 내지 않고 현재 위치 조회는 낸다`, async () => {
      const byPlace = await executeFunction(name, { place: "여의도" }, ctx({ userLocation: HOME }));
      expect(byPlace.render).toBeUndefined();
      const byCurrent = await executeFunction(name, {}, ctx({ userLocation: HOME }));
      expect(byCurrent.render).toBeDefined();
    });
  }
});

describe("get_subway_arrivals stationName 인자 (K3 ②)", () => {
  const mockByName = vi.mocked(fetchSubwayArrivals);
  beforeEach(() => {
    mockByName.mockReset();
    vi.mocked(fetchNearbySubwayArrivals).mockClear();
  });

  it("역명이 있으면 역명 조회 — 좌표·커버리지 무관(위치 없음·해외에서도 호출)", async () => {
    const arrivals = { stationName: "천호", arrivals: [{ line: "5호선", message: "곧 도착" }] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockByName.mockResolvedValue(arrivals as any);
    const r = await executeFunction("get_subway_arrivals", { stationName: "천호" }, ctx({ userLocation: OSAKA }));
    expect(mockByName).toHaveBeenCalledWith("천호");
    expect(fetchNearbySubwayArrivals).not.toHaveBeenCalled();
    expect(r.data).toEqual(arrivals);
    expect(r.render).toBeUndefined();
    expect(r.source).toEqual([{ label: "source.seoulopen" }]);
  });

  it("실시간 미제공 역은 arrivals:null을 그대로 싣는다 — 0건과 구분", async () => {
    mockByName.mockResolvedValue(null);
    const r = await executeFunction("get_subway_arrivals", { stationName: "부산역" }, ctx());
    expect(r.data).toEqual({ stationName: "부산역", arrivals: null });
  });
});
