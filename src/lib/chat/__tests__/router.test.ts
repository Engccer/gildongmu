/**
 * executeFunction 라우터 테스트.
 * searchPlaces의 실제 시그니처: searchPlaces(params: PlaceSearchParams): Promise<PlaceSearchResult>
 * PlaceSearchResult = { places: Place[], provider, query }
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/providers/places", () => ({
  searchPlaces: vi.fn(async ({ lang }: { lang: string }) => ({
    places: [
      {
        id: "1",
        name: lang === "en" ? "Gildong Cafe" : "길동 카페",
        category: lang === "en" ? "cafe" : "카페",
        address: lang === "en" ? "Gangdong" : "강동구",
        roadAddress: "",
        lat: 37.5,
        lng: 127.1,
      },
    ],
    provider: "kakao-local",
    query: "q",
  })),
}));

vi.mock("@/lib/providers/juso-address", () => ({
  searchJusoAddresses: vi.fn(async (_keyword: string) => [
    {
      roadAddr: "서울특별시 중구 세종대로 110 (태평로1가)",
      roadAddrPart1: "서울특별시 중구 세종대로 110",
      jibunAddr: "서울특별시 중구 태평로1가 31",
      engAddr: "110 Sejong-daero, Jung-gu, Seoul",
      zipNo: "04524",
      bdNm: "서울특별시청",
    },
  ]),
}));

import { executeFunction } from "../router";

const ctxKo = { locale: "ko", dataLocale: "ko" as const };

describe("executeFunction search_places", () => {
  it("ko → searchPlaces({ query, lang:'ko' }) 호출 + places render + summary 포함", async () => {
    const r = await executeFunction("search_places", { query: "카페" }, ctxKo);
    expect(r.render).toEqual({
      type: "places",
      places: [expect.objectContaining({ name: "길동 카페" })],
    });
    expect(r.summary).toContain("길동 카페");

    const { searchPlaces } = await import("@/lib/providers/places");
    expect(searchPlaces).toHaveBeenCalledWith({ query: "카페", lang: "ko" });
  });

  it("en(dataLocale:'en') → lang:'en' 으로 호출 + 영문 장소명 반환", async () => {
    const r = await executeFunction("search_places", { query: "cafe" }, {
      locale: "en",
      dataLocale: "en",
    });
    expect((r.render as { type: string; places: { name: string }[] }).places[0].name).toBe(
      "Gildong Cafe",
    );

    const { searchPlaces } = await import("@/lib/providers/places");
    expect(searchPlaces).toHaveBeenCalledWith({ query: "cafe", lang: "en" });
  });

  it("알 수 없는 도구 이름 → Error throw", async () => {
    await expect(executeFunction("nope", {}, ctxKo)).rejects.toThrow("알 수 없는 도구");
  });
});

describe("executeFunction search_address", () => {
  it("keyword → searchJusoAddresses 호출 + addresses render + summary 포함", async () => {
    const r = await executeFunction("search_address", { keyword: "세종대로 110" }, ctxKo);
    expect(r.render).toEqual({
      type: "addresses",
      results: [expect.objectContaining({ roadAddrPart1: "서울특별시 중구 세종대로 110" })],
    });
    expect(r.summary).toContain("세종대로 110");

    const { searchJusoAddresses } = await import("@/lib/providers/juso-address");
    expect(searchJusoAddresses).toHaveBeenCalledWith("세종대로 110");
  });

  it("keyword 누락 시 빈 문자열로 호출", async () => {
    await executeFunction("search_address", {}, ctxKo);
    const { searchJusoAddresses } = await import("@/lib/providers/juso-address");
    expect(searchJusoAddresses).toHaveBeenCalledWith("");
  });
});

// 좌표 도구 3종 — get_bus_arrivals, get_bike_stations, get_air_quality
describe("executeFunction 좌표 도구 3종", () => {
  const ctxWithLoc = { ...ctxKo, userLocation: { lat: 37.55, lng: 127.1 } };

  // get_bus_arrivals
  it("get_bus_arrivals place 지정 → searchPlaces 호출 + bus place render", async () => {
    const r = await executeFunction("get_bus_arrivals", { place: "길동" }, ctxKo);
    expect(r.render).toEqual({ type: "bus", mode: "place", lat: 37.5, lng: 127.1 });
    expect(r.summary).toContain("길동");
    expect(r.summary).toContain("버스");
  });

  it("get_bus_arrivals place 없고 userLocation 있음 → bus current render", async () => {
    const r = await executeFunction("get_bus_arrivals", {}, ctxWithLoc);
    expect(r.render).toEqual({ type: "bus", mode: "current" });
    expect(r.summary).toContain("버스");
  });

  it("get_bus_arrivals place 없고 userLocation 없음 → render 없는 summary", async () => {
    const r = await executeFunction("get_bus_arrivals", {}, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toBeTruthy();
  });

  it("get_bus_arrivals place 지정했으나 검색 결과 없음 → render 없는 summary", async () => {
    const { searchPlaces } = await import("@/lib/providers/places");
    vi.mocked(searchPlaces).mockResolvedValueOnce({ places: [], provider: "kakao-local", query: "없는곳" });
    const r = await executeFunction("get_bus_arrivals", { place: "없는곳" }, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toContain("없는곳");
  });

  // get_bike_stations
  it("get_bike_stations place 지정 → bike place render", async () => {
    const r = await executeFunction("get_bike_stations", { place: "길동" }, ctxKo);
    expect(r.render).toEqual({ type: "bike", mode: "place", lat: 37.5, lng: 127.1 });
    expect(r.summary).toContain("따릉이");
  });

  it("get_bike_stations place 없고 userLocation 있음 → bike current render", async () => {
    const r = await executeFunction("get_bike_stations", {}, ctxWithLoc);
    expect(r.render).toEqual({ type: "bike", mode: "current" });
    expect(r.summary).toContain("따릉이");
  });

  it("get_bike_stations place 없고 userLocation 없음 → render 없는 summary", async () => {
    const r = await executeFunction("get_bike_stations", {}, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toBeTruthy();
  });

  // get_air_quality
  it("get_air_quality place 지정 → air-quality render with lat/lng", async () => {
    const r = await executeFunction("get_air_quality", { place: "길동" }, ctxKo);
    expect(r.render).toEqual({ type: "air-quality", lat: 37.5, lng: 127.1 });
    expect(r.summary).toContain("공기질");
  });

  it("get_air_quality place 없고 userLocation 있음 → air-quality render with userLocation", async () => {
    const r = await executeFunction("get_air_quality", {}, ctxWithLoc);
    expect(r.render).toEqual({ type: "air-quality", lat: 37.55, lng: 127.1 });
    expect(r.summary).toContain("공기질");
  });

  it("get_air_quality place 없고 userLocation 없음 → render 없는 summary", async () => {
    const r = await executeFunction("get_air_quality", {}, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toBeTruthy();
  });

  it("get_air_quality place 지정했으나 검색 결과 없음 → render 없는 summary", async () => {
    const { searchPlaces } = await import("@/lib/providers/places");
    vi.mocked(searchPlaces).mockResolvedValueOnce({ places: [], provider: "kakao-local", query: "없는곳" });
    const r = await executeFunction("get_air_quality", { place: "없는곳" }, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toBeTruthy();
  });
});

// 역명 도구 2종 — get_station_meta, get_station_facilities
describe("executeFunction 역명 도구 2종", () => {
  it("get_station_meta stationName 있음 → station-meta render + stationName 전달", async () => {
    const r = await executeFunction("get_station_meta", { stationName: "강남" }, ctxKo);
    expect(r.render).toEqual({ type: "station-meta", stationName: "강남" });
    expect(r.summary).toContain("강남");
  });

  it("get_station_meta stationName 빈 문자열 → render 생략 + summary 반환", async () => {
    const r = await executeFunction("get_station_meta", { stationName: "" }, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toBeTruthy();
  });

  it("get_station_meta stationName 누락 → render 생략 + summary 반환", async () => {
    const r = await executeFunction("get_station_meta", {}, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toBeTruthy();
  });

  it("get_station_facilities stationName 있음 → station-facilities render + stationName 전달", async () => {
    const r = await executeFunction("get_station_facilities", { stationName: "서울역" }, ctxKo);
    expect(r.render).toEqual({ type: "station-facilities", stationName: "서울역" });
    expect(r.summary).toContain("서울역");
  });

  it("get_station_facilities stationName 빈 문자열 → render 생략 + summary 반환", async () => {
    const r = await executeFunction("get_station_facilities", { stationName: "" }, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toBeTruthy();
  });

  it("get_station_facilities stationName 누락 → render 생략 + summary 반환", async () => {
    const r = await executeFunction("get_station_facilities", {}, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toBeTruthy();
  });
});

// dest 도구 2종 — get_car_route, get_transit_route
describe("executeFunction dest 도구 2종", () => {
  it("get_car_route destination 지정 → car-route render with dest{lat,lng,name}", async () => {
    const r = await executeFunction("get_car_route", { destination: "강남역" }, ctxKo);
    expect(r.render).toEqual({
      type: "car-route",
      dest: { lat: 37.5, lng: 127.1, name: "길동 카페" },
    });
    expect(r.summary).toContain("자동차");
  });

  it("get_car_route destination 누락 → render 없는 summary", async () => {
    const r = await executeFunction("get_car_route", {}, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toBeTruthy();
  });

  it("get_car_route destination 검색 결과 없음 → render 없는 summary", async () => {
    const { searchPlaces } = await import("@/lib/providers/places");
    vi.mocked(searchPlaces).mockResolvedValueOnce({ places: [], provider: "kakao-local", query: "없는곳" });
    const r = await executeFunction("get_car_route", { destination: "없는곳" }, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toContain("없는곳");
  });

  it("get_transit_route destination 지정 → transit-route render with dest{lat,lng,name}", async () => {
    const r = await executeFunction("get_transit_route", { destination: "강남역" }, ctxKo);
    expect(r.render).toEqual({
      type: "transit-route",
      dest: { lat: 37.5, lng: 127.1, name: "길동 카페" },
    });
    expect(r.summary).toContain("대중교통");
  });

  it("get_transit_route destination 누락 → render 없는 summary", async () => {
    const r = await executeFunction("get_transit_route", {}, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toBeTruthy();
  });

  it("get_transit_route destination 검색 결과 없음 → render 없는 summary", async () => {
    const { searchPlaces } = await import("@/lib/providers/places");
    vi.mocked(searchPlaces).mockResolvedValueOnce({ places: [], provider: "kakao-local", query: "없는곳" });
    const r = await executeFunction("get_transit_route", { destination: "없는곳" }, ctxKo);
    expect(r.render).toBeUndefined();
    expect(r.summary).toContain("없는곳");
  });
});

// 현재위치 nearby 4도구 — provider 호출 없이 summary + render type만 반환
describe("executeFunction 현재위치 nearby 4도구", () => {
  it("get_subway_arrivals → subway-nearby render + 요약 포함", async () => {
    const r = await executeFunction("get_subway_arrivals", {}, ctxKo);
    expect(r.render).toEqual({ type: "subway-nearby" });
    expect(r.summary).toContain("지하철");
  });

  it("get_night_clinics → clinics-nearby render + 요약 포함", async () => {
    const r = await executeFunction("get_night_clinics", {}, ctxKo);
    expect(r.render).toEqual({ type: "clinics-nearby" });
    expect(r.summary).toContain("소아");
  });

  it("get_kids_places → kids-nearby render + 요약 포함", async () => {
    const r = await executeFunction("get_kids_places", {}, ctxKo);
    expect(r.render).toEqual({ type: "kids-nearby" });
    expect(r.summary).toContain("아이");
  });

  it("get_surroundings → surroundings-nearby render + 요약 포함", async () => {
    const r = await executeFunction("get_surroundings", {}, ctxKo);
    expect(r.render).toEqual({ type: "surroundings-nearby" });
    expect(r.summary).toContain("주변");
  });
});
