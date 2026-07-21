import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/providers/places", () => ({
  searchPlaces: vi.fn(async ({ lang }: { lang: string }) => ({
    places: [{ id: "1", name: lang === "en" ? "Gildong Cafe" : "길동 카페",
      category: "카페", address: "강동구", roadAddress: "강동대로 1", lat: 37.5, lng: 127.1 }],
    provider: "kakao-local", query: "q",
  })),
}));
vi.mock("@/lib/providers/juso-address", () => ({
  searchJusoAddresses: vi.fn(async () => [
    { roadAddr: "서울특별시 중구 세종대로 110", roadAddrPart1: "", jibunAddr: "",
      engAddr: "110 Sejong-daero", zipNo: "04524", bdNm: "서울시청" }]),
}));
vi.mock("@/lib/providers/air-quality", () => ({
  findAirQualityNear: vi.fn(async () => ({ khai: 229, grade: "나쁨", pm10: 80, pm25: 40, station: "천호대로", distanceKm: 0.5 })),
}));
vi.mock("@/lib/providers/subway-nearby", () => ({
  fetchNearbySubwayArrivals: vi.fn(async () => [{ name: "강남", arrivals: [] }]),
}));
vi.mock("@/lib/providers/night-clinic", () => ({
  findNightClinicsNear: vi.fn(async () => []),
}));
vi.mock("@/lib/providers/kids-places", () => ({
  findKidsPlacesNear: vi.fn(async () => []),
}));
vi.mock("@/lib/providers/surroundings", () => ({
  findSurroundingsNear: vi.fn(async () => []),
}));
vi.mock("@/lib/bus", () => ({
  fetchNearbyBusStops: vi.fn(async () => []),
}));
vi.mock("@/lib/providers/seoul-bike", () => ({
  fetchNearbyBikeStations: vi.fn(async () => []),
}));
vi.mock("@/lib/subway-stations", () => ({
  findStationMeta: vi.fn(() => null),
}));
vi.mock("@/lib/providers/korail-facilities", () => ({
  fetchStationFacilities: vi.fn(async () => null),
}));
vi.mock("@/lib/providers/seoul-metro-facilities", () => ({
  fetchSeoulMetroFacilities: vi.fn(async () => null),
}));
vi.mock("@/lib/providers/kakao-navi", () => ({
  getCarRouteBriefing: vi.fn(async () => ({ steps: [], totalSeconds: 0, totalMeters: 0 })),
}));
vi.mock("@/lib/providers/ncp-directions", () => ({
  getCarRouteBriefingEn: vi.fn(async () => ({ steps: [], totalSeconds: 0, totalMeters: 0 })),
}));
vi.mock("@/lib/providers/odsay", () => ({
  getTransitRoute: vi.fn(async () => null),
}));
vi.mock("@/lib/providers/tmap-pedestrian", () => ({
  getWalkRouteBriefing: vi.fn(async () => ({
    distanceMeters: 850,
    durationSeconds: 660,
    steps: [{ description: "158m 이동 후 우회전" }, { description: "목적지 도착" }],
  })),
}));
vi.mock("@/lib/env", () => ({
  hasNcpMapsKeys: vi.fn(() => false),
  // 기본 true — get_walk_route 정상 경로 테스트는 별도 설정 없이 통과, 게이트 off
  // 테스트만 mockReturnValueOnce(false)로 그 1회 호출만 뒤집는다.
  hasTmapKey: vi.fn(() => true),
}));

import { executeFunction } from "../router";
import { searchPlaces } from "@/lib/providers/places";
import { getWalkRouteBriefing } from "@/lib/providers/tmap-pedestrian";
import { hasTmapKey } from "@/lib/env";

const ctxKo = { locale: "ko", dataLocale: "ko" as const, userLocation: { lat: 37.5, lng: 127.1 } };
const ctxNoLoc = { locale: "ko", dataLocale: "ko" as const };

/** Record<string,unknown> 에서 단계적으로 키를 내려가는 헬퍼. */
function dig(data: Record<string, unknown>, ...keys: string[]): unknown {
  let cur: unknown = data;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

describe("executeFunction — 실데이터 + render + source", () => {
  it("search_places: data.places + render + source(kakao)", async () => {
    const r = await executeFunction("search_places", { query: "길동 카페" }, ctxKo);
    expect(dig(r.data, "count")).toBe(1);
    expect(r.render).toEqual({ type: "places", places: expect.any(Array) });
    expect(r.source).toEqual([{ label: "source.kakao" }]);
  });

  it("search_places: anchorOf(ctx) 좌표를 searchPlaces에 전달해 거리순", async () => {
    await executeFunction("search_places", { query: "맥도날드" }, ctxKo);
    expect(vi.mocked(searchPlaces)).toHaveBeenCalledWith(
      expect.objectContaining({ query: "맥도날드", lat: 37.5, lng: 127.1 }),
    );
  });

  it("search_places: 위치 없으면 좌표 없이 검색(현행 동작)", async () => {
    await executeFunction("search_places", { query: "맥도날드" }, ctxNoLoc);
    expect(vi.mocked(searchPlaces)).toHaveBeenCalledWith(
      expect.objectContaining({ query: "맥도날드", lat: undefined, lng: undefined }),
    );
  });

  it("get_air_quality: provider 실데이터를 data에 싣고 카드 마운트", async () => {
    const r = await executeFunction("get_air_quality", {}, ctxKo);
    expect(dig(r.data, "air", "grade")).toBe("나쁨");
    expect(r.render).toEqual({ type: "air-quality", lat: 37.5, lng: 127.1 });
    expect(r.source).toEqual([{ label: "source.airkorea" }]);
  });

  it("get_subway_arrivals: 위치 있으면 실데이터", async () => {
    const r = await executeFunction("get_subway_arrivals", {}, ctxKo);
    expect(dig(r.data, "arrivals")).toHaveLength(1);
    expect(r.render).toEqual({ type: "subway-nearby" });
  });

  it("위치 없는 nearby 도구는 data.error", async () => {
    const r = await executeFunction("get_subway_arrivals", {}, ctxNoLoc);
    expect(dig(r.data, "error")).toBeTruthy();
    expect(r.render).toBeUndefined();
  });

  it("알 수 없는 도구는 throw", async () => {
    await expect(executeFunction("nope", {}, ctxKo)).rejects.toThrow();
  });
});

describe("executeFunction — get_walk_route", () => {
  it("정상 경로: destination 지오코딩 + 요약·steps + source(tmap), render 없음", async () => {
    const r = await executeFunction("get_walk_route", { destination: "강남역" }, ctxKo);
    expect(dig(r.data, "destination")).toBe("길동 카페");
    expect(dig(r.data, "distanceMeters")).toBe(850);
    expect(dig(r.data, "durationSeconds")).toBe(660);
    expect(dig(r.data, "steps")).toHaveLength(2);
    expect(dig(r.data, "truncated")).toBeUndefined();
    expect(r.source).toEqual([{ label: "source.tmap" }]);
    expect(r.render).toBeUndefined();
  });

  it("steps가 20개 넘으면 상위 20개로 캡 + truncated 플래그", async () => {
    const manySteps = Array.from({ length: 25 }, (_, i) => ({ description: `안내 ${i}` }));
    vi.mocked(getWalkRouteBriefing).mockResolvedValueOnce({
      distanceMeters: 5000,
      durationSeconds: 4000,
      steps: manySteps,
    });
    const r = await executeFunction("get_walk_route", { destination: "강남역" }, ctxKo);
    expect(dig(r.data, "steps")).toHaveLength(20);
    expect(dig(r.data, "truncated")).toBe(true);
  });

  it("destination 없으면 data.error", async () => {
    const r = await executeFunction("get_walk_route", {}, ctxKo);
    expect(dig(r.data, "error")).toBeTruthy();
  });

  it("destination 위치를 못 찾으면 data.error", async () => {
    vi.mocked(searchPlaces).mockResolvedValueOnce({ places: [], provider: "kakao-local", query: "q" });
    const r = await executeFunction("get_walk_route", { destination: "존재하지않는곳" }, ctxKo);
    expect(dig(r.data, "error")).toBeTruthy();
  });

  it("현재 위치 없으면 NO_LOCATION(Tmap 호출 없음)", async () => {
    const before = vi.mocked(getWalkRouteBriefing).mock.calls.length;
    const r = await executeFunction("get_walk_route", { destination: "강남역" }, ctxNoLoc);
    expect(dig(r.data, "error")).toBeTruthy();
    expect(r.source).toEqual([{ label: "source.tmap" }]);
    expect(vi.mocked(getWalkRouteBriefing).mock.calls.length).toBe(before);
  });

  it("게이트 off(hasTmapKey=false)면 실행부 직접 호출도 차단(Tmap provider 미호출)", async () => {
    vi.mocked(hasTmapKey).mockReturnValueOnce(false);
    const before = vi.mocked(getWalkRouteBriefing).mock.calls.length;
    const r = await executeFunction("get_walk_route", { destination: "강남역" }, ctxKo);
    expect(dig(r.data, "error")).toBeTruthy();
    expect(vi.mocked(getWalkRouteBriefing).mock.calls.length).toBe(before);
  });
});
