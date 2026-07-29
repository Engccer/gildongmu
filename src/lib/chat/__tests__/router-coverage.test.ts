import { describe, it, expect, vi } from "vitest";

const SF = { lat: 37.7749, lng: -122.4194 };
const SEOUL = { lat: 37.5665, lng: 126.978 };

vi.mock("@/lib/providers/places", () => ({
  searchPlaces: vi.fn(async ({ query }: { query: string }) => ({
    places: [{ id: "1", name: query, category: "", address: "", roadAddress: "", lat: SEOUL.lat, lng: SEOUL.lng }],
    provider: "kakao-local", query,
  })),
}));
vi.mock("@/lib/providers/weather", () => ({
  findWeatherNear: vi.fn(async () => ({
    sky: { code: 1, label: "clear" }, precipitation: { code: 0, label: "none" },
    tempC: 20, tempMax: 22, tempMin: 18, humidity: 50, precipProbability: 0,
    baseTime: "10:00", grid: { nx: 60, ny: 127 },
  })),
}));
vi.mock("@/lib/providers/subway-nearby", () => ({
  fetchNearbySubwayArrivals: vi.fn(async () => [{ name: "강남", arrivals: [] }]),
}));
vi.mock("@/lib/providers/air-quality", () => ({
  findAirQualityNear: vi.fn(async () => ({
    khai: 50, grade: "좋음", pm10: 20, pm25: 10, station: "테스트", distanceKm: 0.3,
  })),
}));
vi.mock("@/lib/providers/kakao-navi", () => ({
  getCarRouteBriefing: vi.fn(async () => ({ steps: [], totalSeconds: 0, totalMeters: 0 })),
}));
vi.mock("@/lib/providers/ncp-directions", () => ({
  getCarRouteBriefingEn: vi.fn(async () => ({ steps: [], totalSeconds: 0, totalMeters: 0 })),
}));
vi.mock("@/lib/env", () => ({
  hasNcpMapsKeys: vi.fn(() => false),
  hasWalkRouteKey: vi.fn(() => true),
  hasTmapKey: vi.fn(() => true),
  hasKakaoKey: vi.fn(() => false),
}));

import { executeFunction } from "../router";
import type { ExecutionContext } from "../types";

function ctxWith(over: Partial<ExecutionContext>): ExecutionContext {
  return { locale: "ko", dataLocale: "ko", ...over };
}

const OUT_OF_COVERAGE_NOTICE =
  "현재 위치 기반 기능은 대한민국 안에서 제공됩니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다.";

describe("executeFunction — 커버리지 게이트", () => {
  it("userLocation이 해외면 get_weather는 provider 없이 outOfCoverage 데이터", async () => {
    const r = await executeFunction("get_weather", {}, ctxWith({ userLocation: SF }));
    expect(r.data).toEqual({ outOfCoverage: true, notice: OUT_OF_COVERAGE_NOTICE });
    expect(r.render).toBeUndefined();
    expect(r.source).toBeUndefined();
  });

  it("placeAnchor가 한국이면 userLocation이 해외여도 주변 도구 정상 실행", async () => {
    const r = await executeFunction(
      "get_subway_arrivals",
      {},
      ctxWith({ placeAnchor: { ...SEOUL, name: "경복궁" }, userLocation: SF }),
    );
    expect(r.data).not.toHaveProperty("outOfCoverage");
  });

  it("길찾기는 출발지(userLocation) 기준 — 해외면 outOfCoverage", async () => {
    // get_car_route 실 파라미터명은 destination(declarations.ts 참조).
    const r = await executeFunction(
      "get_car_route",
      { destination: "경복궁" },
      ctxWith({ placeAnchor: { ...SEOUL, name: "경복궁" }, userLocation: SF }),
    );
    expect(r.data).toMatchObject({ outOfCoverage: true });
  });

  it("resolveCoord: place 인자로 해석된 한국 좌표는 게이트를 통과한다(userLocation 해외라도)", async () => {
    const r = await executeFunction("get_air_quality", { place: "강남역" }, ctxWith({ userLocation: SF }));
    expect(r.data).not.toHaveProperty("outOfCoverage");
  });

  it("resolveCoord: place 미지정이면 anchorOf 폴백 좌표로 판정한다(해외면 차단)", async () => {
    const r = await executeFunction("get_air_quality", {}, ctxWith({ userLocation: SF }));
    expect(r.data).toEqual({ outOfCoverage: true, notice: OUT_OF_COVERAGE_NOTICE });
  });
});
