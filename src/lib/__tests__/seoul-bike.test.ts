// 2026-06-16 실 bikeList 호출로 envelope·필드명 검증 완료(강동구 길동 실응답). fixture 구조가 실응답과 일치.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../env", () => ({
  env: { SEOUL_OPEN_DATA_KEY: "test-key" },
}));

import fixture from "./fixtures/seoul-bike.json";
import {
  parseBikeRows,
  parseBikeStations,
  fetchNearbyBikeStations,
} from "../providers/seoul-bike";

// 강동구 길동 기준 좌표(설계 문서와 동일)
const O_LAT = 37.5385;
const O_LNG = 127.1378;

describe("parseBikeRows", () => {
  it("rentBikeStatus.row 배열을 뽑는다", () => {
    expect(parseBikeRows(fixture.nearbyPage).length).toBe(5);
  });
  it("빈 결과·비정상 입력은 빈 배열", () => {
    expect(parseBikeRows(fixture.emptyPage)).toEqual([]);
    expect(parseBikeRows(null)).toEqual([]);
    expect(parseBikeRows({})).toEqual([]);
  });
});

describe("parseBikeStations", () => {
  it("거리 오름차순 정렬 + 필드 매핑", () => {
    const stations = parseBikeStations(fixture.nearbyPage, O_LAT, O_LNG);
    // 좌표 정상 4개 + 좌표불명 1개 = 5개(필터는 fetch 단계 cap에서)
    expect(stations.length).toBe(5);
    // 최근접은 "3681. 길동 마루빌딩"(236m)
    expect(stations[0].name).toBe("3681. 길동 마루빌딩");
    expect(stations[0].bikesAvailable).toBe(31);
    expect(stations[0].racksTotal).toBe(10);
    expect(stations[0].distanceMeters).toBeGreaterThan(220);
    expect(stations[0].distanceMeters).toBeLessThan(260);
  });
  it("좌표 비유한 row는 distanceMeters Infinity로 후미", () => {
    const stations = parseBikeStations(fixture.nearbyPage, O_LAT, O_LNG);
    const last = stations[stations.length - 1];
    expect(last.stationId).toBe("ST-BAD");
    expect(last.distanceMeters).toBe(Number.POSITIVE_INFINITY);
  });
  it("bikesAvailable 0은 0으로 보존(정보 없음과 구분 안 함 — 따릉이는 항상 수치)", () => {
    const stations = parseBikeStations(fixture.nearbyPage, O_LAT, O_LNG);
    const bad = stations.find((s) => s.stationId === "ST-BAD")!;
    expect(bad.bikesAvailable).toBe(0);
  });
});

describe("fetchNearbyBikeStations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1km 이내 상위 5 + 거리 정렬, 1km 밖·좌표불명 제외", async () => {
    // 단일 페이지(5건 < 1000)라 한 번만 fetch하고 종료
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture.nearbyPage), { status: 200 }),
    );
    const stations = await fetchNearbyBikeStations(O_LAT, O_LNG);
    // 좌표 정상 4개 중 1km 이내 3개("먼곳" 2km·"좌표불명" Infinity 제외)
    expect(stations.every((s) => s.distanceMeters <= 1000)).toBe(true);
    expect(stations.map((s) => s.stationId)).not.toContain("ST-BAD");
    expect(stations.map((s) => s.stationId)).not.toContain("ST-FAR");
    expect(stations[0].name).toBe("3681. 길동 마루빌딩");
  });

  it("RESULT.CODE가 INFO-000이 아니면 throw(조회 실패와 정보 없음 구분)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rentBikeStatus: { RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } },
        }),
        { status: 200 },
      ),
    );
    await expect(fetchNearbyBikeStations(O_LAT, O_LNG)).rejects.toThrow();
  });

  it("RESULT/CODE 부재(비정상 응답)도 throw(조용한 성공 금지)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ rentBikeStatus: { row: [] } }), { status: 200 }),
    );
    await expect(fetchNearbyBikeStations(O_LAT, O_LNG)).rejects.toThrow();
  });

  it("키 없으면 빈 배열(방어적)", async () => {
    const mod = await import("../env");
    const orig = mod.env.SEOUL_OPEN_DATA_KEY;
    mod.env.SEOUL_OPEN_DATA_KEY = undefined;
    const spy = vi.spyOn(globalThis, "fetch");
    const stations = await fetchNearbyBikeStations(O_LAT, O_LNG);
    expect(stations).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    mod.env.SEOUL_OPEN_DATA_KEY = orig;
  });
});
