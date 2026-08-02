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
  isBikeServiceArea,
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

  it("무효 키의 HTTP 200 + XML 본문 → 인증키를 지목하고 throw (SyntaxError 위장 금지)", async () => {
    // 서울 열린데이터는 키가 무효하면 /json/ 경로여도 200 + XML을 준다.
    // res.json()을 그냥 부르면 `Unexpected token '<'`가 되어 502의 원인이 가려진다.
    const xml =
      "<RESULT><CODE>INFO-100</CODE><MESSAGE><![CDATA[인증키가 유효하지 않습니다.]]></MESSAGE></RESULT>";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(xml, { status: 200 }));
    await expect(fetchNearbyBikeStations(O_LAT, O_LNG)).rejects.toThrow(/INFO-100.*인증키/);
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

describe("isBikeServiceArea", () => {
  it("서울 안은 서비스권", () => {
    expect(isBikeServiceArea(37.5385, 127.1234)).toBe(true); // 길동
    expect(isBikeServiceArea(37.669, 127.047)).toBe(true); // 도봉
  });

  it("서울 경계 인접은 서비스권 — 대여소가 조회 반경에 들어올 수 있다", () => {
    // 하남 미사는 최근접 대여소 1.13km(실측). 반경 1km 밖이라 0건이지만
    // "미제공"이라 말하면 거짓이다 — 조금만 더 가면 실제로 있다.
    expect(isBikeServiceArea(37.562, 127.193)).toBe(true);
    expect(isBikeServiceArea(37.4292, 126.9877)).toBe(true); // 과천
  });

  it("지방은 미제공 — 0건과 뭉개지 않는다", () => {
    expect(isBikeServiceArea(35.1578, 129.0594)).toBe(false); // 부산 서면 309km
    expect(isBikeServiceArea(36.352, 127.378)).toBe(false); // 대전 둔산 123km
    expect(isBikeServiceArea(37.88, 127.729)).toBe(false); // 춘천 59km
  });
});
