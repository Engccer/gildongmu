// declarations.test.ts — 키 게이트별 도구 노출 여부 테스트
import { describe, it, expect, vi, afterEach } from "vitest";

describe("availableDeclarations", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("카카오 키 있으면 search_places 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "search_places")).toBe(true);
  });

  it("카카오 키 없으면 search_places 미노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "search_places")).toBe(false);
  });

  it("juso 키 있으면 search_address 노출", async () => {
    vi.stubEnv("JUSO_CONFM_KEY", "j");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "search_address")).toBe(true);
  });

  it("juso 키 없으면 search_address 미노출", async () => {
    vi.stubEnv("JUSO_CONFM_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "search_address")).toBe(false);
  });

  // get_subway_arrivals — SEOUL_SUBWAY_REALTIME_KEY 게이트
  it("지하철 실시간 키 있으면 get_subway_arrivals 노출", async () => {
    vi.stubEnv("SEOUL_SUBWAY_REALTIME_KEY", "s");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_subway_arrivals")).toBe(true);
  });

  it("지하철 실시간 키 없으면 get_subway_arrivals 미노출", async () => {
    vi.stubEnv("SEOUL_SUBWAY_REALTIME_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_subway_arrivals")).toBe(false);
  });

  // get_night_clinics — DATA_GO_KR_API_KEY 게이트
  it("data.go.kr 키 있으면 get_night_clinics 노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "d");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_night_clinics")).toBe(true);
  });

  it("data.go.kr 키 없으면 get_night_clinics 미노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_night_clinics")).toBe(false);
  });

  // get_kids_places — KAKAO_REST_API_KEY 게이트
  it("카카오 키 있으면 get_kids_places 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_kids_places")).toBe(true);
  });

  it("카카오 키 없으면 get_kids_places 미노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_kids_places")).toBe(false);
  });

  // get_surroundings — KAKAO_REST_API_KEY 게이트
  it("카카오 키 있으면 get_surroundings 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_surroundings")).toBe(true);
  });

  it("카카오 키 없으면 get_surroundings 미노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_surroundings")).toBe(false);
  });

  // get_bus_arrivals — DATA_GO_KR_API_KEY 게이트
  it("data.go.kr 키 있으면 get_bus_arrivals 노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "d");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_bus_arrivals")).toBe(true);
  });

  it("data.go.kr 키 없으면 get_bus_arrivals 미노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_bus_arrivals")).toBe(false);
  });

  // get_bike_stations — SEOUL_OPEN_DATA_KEY 게이트
  it("서울 열린데이터 키 있으면 get_bike_stations 노출", async () => {
    vi.stubEnv("SEOUL_OPEN_DATA_KEY", "s");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_bike_stations")).toBe(true);
  });

  it("서울 열린데이터 키 없으면 get_bike_stations 미노출", async () => {
    vi.stubEnv("SEOUL_OPEN_DATA_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_bike_stations")).toBe(false);
  });

  // get_air_quality — DATA_GO_KR_API_KEY 게이트
  it("data.go.kr 키 있으면 get_air_quality 노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "d");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_air_quality")).toBe(true);
  });

  it("data.go.kr 키 없으면 get_air_quality 미노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_air_quality")).toBe(false);
  });

  // get_weather — DATA_GO_KR_API_KEY 게이트(공기질과 동일 키)
  it("data.go.kr 키 있으면 get_weather 노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "d");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_weather")).toBe(true);
  });

  it("data.go.kr 키 없으면 get_weather 미노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_weather")).toBe(false);
  });

  // get_station_meta — 게이트 없음(정적 seed), 키 전부 비어도 항상 노출
  it("get_station_meta: 키가 전부 없어도 항상 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined);
    vi.stubEnv("DATA_GO_KR_API_KEY", undefined);
    vi.stubEnv("SEOUL_SUBWAY_REALTIME_KEY", undefined);
    vi.stubEnv("SEOUL_OPEN_DATA_KEY", undefined);
    vi.stubEnv("JUSO_CONFM_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_station_meta")).toBe(true);
  });

  it("get_station_meta: 키가 있어도 항상 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_station_meta")).toBe(true);
  });

  // get_station_facilities — DATA_GO_KR_API_KEY 게이트
  it("data.go.kr 키 있으면 get_station_facilities 노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "d");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_station_facilities")).toBe(true);
  });

  it("data.go.kr 키 없으면 get_station_facilities 미노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_station_facilities")).toBe(false);
  });

  // get_car_route — hasCarRouteKey(TMAP_APP_KEY || KAKAO_REST_API_KEY) 게이트
  it("Tmap 키만 있어도 get_car_route 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined);
    vi.stubEnv("TMAP_APP_KEY", "t");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_car_route")).toBe(true);
  });

  it("카카오 키만 있어도 get_car_route 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    vi.stubEnv("TMAP_APP_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_car_route")).toBe(true);
  });

  it("카카오·Tmap 키 둘 다 없으면 get_car_route 미노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined);
    vi.stubEnv("TMAP_APP_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_car_route")).toBe(false);
  });

  // get_transit_route — ODSAY_API_KEY 게이트
  it("ODsay 키 있으면 get_transit_route 노출", async () => {
    vi.stubEnv("ODSAY_API_KEY", "o");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_transit_route")).toBe(true);
  });

  it("ODsay 키 없으면 get_transit_route 미노출", async () => {
    vi.stubEnv("ODSAY_API_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_transit_route")).toBe(false);
  });

  // get_walk_route — hasWalkRouteKey(KAKAO_REST_API_KEY || TMAP_APP_KEY) 게이트
  it("Tmap 키만 있어도 get_walk_route 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined);
    vi.stubEnv("TMAP_APP_KEY", "t");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_walk_route")).toBe(true);
  });

  it("카카오 키만 있어도 get_walk_route 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    vi.stubEnv("TMAP_APP_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_walk_route")).toBe(true);
  });

  it("카카오·Tmap 키 둘 다 없으면 get_walk_route 미노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined);
    vi.stubEnv("TMAP_APP_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_walk_route")).toBe(false);
  });

  // get_nearby_barrier_free — DATA_GO_KR_API_KEY 게이트
  it("data.go.kr 키 있으면 get_nearby_barrier_free 노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "d");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_nearby_barrier_free")).toBe(true);
  });

  it("data.go.kr 키 없으면 get_nearby_barrier_free 미노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_nearby_barrier_free")).toBe(false);
  });

  // get_nearby_events — SEOUL_OPEN_DATA_KEY 게이트(따릉이와 동일 키)
  it("서울 열린데이터 키 있으면 get_nearby_events 노출", async () => {
    vi.stubEnv("SEOUL_OPEN_DATA_KEY", "s");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_nearby_events")).toBe(true);
  });

  it("서울 열린데이터 키 없으면 get_nearby_events 미노출", async () => {
    vi.stubEnv("SEOUL_OPEN_DATA_KEY", undefined);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_nearby_events")).toBe(false);
  });
});
