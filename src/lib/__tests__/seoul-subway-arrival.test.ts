import { describe, it, expect, vi, afterEach } from "vitest";
import fixture from "./fixtures/seoul-subway-arrival.json";

// env는 import 시점에 process.env로 동결되므로, fetchSubwayArrivals의 키 유무
// 분기를 테스트하려면 env 모듈을 모킹해 키를 주입한다.
vi.mock("../env", () => ({ env: { SEOUL_SUBWAY_REALTIME_KEY: "test-key" } }));

import { parseSubwayArrivals } from "../providers/seoul-subway-arrival";

// INFO-200(데이터 없음) — 최상위 code(평면 구조, errorMessage 래퍼 없음).
const EMPTY = {
  status: 500,
  code: "INFO-200",
  message: "해당하는 데이터가 없습니다.",
  total: 0,
};

// 인증/쿼터/서버류 오류 — 정보 없음과 구분해야 하는 장애.
const AUTH_ERR = { errorMessage: { code: "ERROR-300", message: "인증키 오류" } };

describe("parseSubwayArrivals — 실시간 도착 정규화", () => {
  it("강남 fixture: 7건, arvlMsg2 낭독 정본·종착·도착초 보존", () => {
    const r = parseSubwayArrivals(fixture, "강남역");
    expect(r).not.toBeNull();
    expect(r!.stationName).toBe("강남"); // "역" 접미사 제거
    expect(r!.arrivals.length).toBe(7);
    const first = r!.arrivals[0];
    expect(first.message).toBeTruthy(); // arvlMsg2 (예 "강남 도착")
    expect(first.destination).toBeTruthy(); // bstatnNm
    expect(typeof first.arrivalSeconds).toBe("number");
  });

  it("subwayId → 노선명 매핑: 강남은 2호선·신분당선 환승", () => {
    const r = parseSubwayArrivals(fixture, "강남");
    const lines = new Set(r!.arrivals.map((a) => a.line));
    expect(lines.has("2호선")).toBe(true); // subwayId 1002
    expect(lines.has("신분당선")).toBe(true); // subwayId 1077
  });

  it("상/하행(updnLine)이 보존되어 컴포넌트가 그룹핑할 수 있다", () => {
    const r = parseSubwayArrivals(fixture, "강남");
    expect(r!.arrivals.every((a) => a.direction.length > 0)).toBe(true);
  });

  it("INFO-200(데이터 없음, 최상위 code) → null (미커버 역, graceful)", () => {
    expect(parseSubwayArrivals(EMPTY, "부산")).toBeNull();
  });

  it("INFO-000이지만 빈 리스트 → arrivals [] (정상 응답, 도착 열차만 없음)", () => {
    const emptyOk = { errorMessage: { code: "INFO-000", total: 0 }, realtimeArrivalList: [] };
    const r = parseSubwayArrivals(emptyOk, "강남");
    expect(r).not.toBeNull();
    expect(r!.arrivals).toEqual([]);
  });

  it("인증/서버 오류 코드 → throw (일시 장애 ≠ 정보 없음)", () => {
    expect(() => parseSubwayArrivals(AUTH_ERR, "강남")).toThrow();
  });

  it("미매핑 호선코드는 line undefined로 graceful — 도착정보 자체는 보존", () => {
    const unknownLine = {
      errorMessage: { code: "INFO-000", total: 1 },
      realtimeArrivalList: [
        { subwayId: "9999", updnLine: "상행", trainLineNm: "X행", bstatnNm: "X",
          barvlDt: "120", arvlMsg2: "2분 후", arvlMsg3: "Y", btrainSttus: "일반" },
      ],
    };
    const r = parseSubwayArrivals(unknownLine, "테스트");
    expect(r!.arrivals[0].line).toBeUndefined();
    expect(r!.arrivals[0].message).toBe("2분 후"); // 정보는 그대로
  });

  it("급행 판정: btrainSttus에 '급행' 포함 시 express true", () => {
    const express = {
      errorMessage: { code: "INFO-000", total: 1 },
      realtimeArrivalList: [
        { subwayId: "1009", updnLine: "상행", trainLineNm: "X", bstatnNm: "Y",
          barvlDt: "60", arvlMsg2: "곧 도착", btrainSttus: "급행" },
      ],
    };
    expect(parseSubwayArrivals(express, "역")!.arrivals[0].express).toBe(true);
  });
});

describe("fetchSubwayArrivals — fetch + 장애 구분", () => {
  afterEach(() => vi.restoreAllMocks());

  function ok(json: unknown): Response {
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }

  it("정상 fetch → 파싱(강남 7건)", async () => {
    const { fetchSubwayArrivals } = await import("../providers/seoul-subway-arrival");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(fixture));
    const r = await fetchSubwayArrivals("강남역");
    expect(r!.arrivals.length).toBe(7);
  });

  it("INFO-200 응답 → null(미커버 역)", async () => {
    const { fetchSubwayArrivals } = await import("../providers/seoul-subway-arrival");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(EMPTY));
    expect(await fetchSubwayArrivals("부산역")).toBeNull();
  });

  it("HTTP 실패 → throw(일시 장애 ≠ 정보 없음)", async () => {
    const { fetchSubwayArrivals } = await import("../providers/seoul-subway-arrival");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
    await expect(fetchSubwayArrivals("강남역")).rejects.toThrow();
  });
});
