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

describe("parseSubwayArrivals — 추적 필드(B2 §6.3 additive)", () => {
  it("btrainNo·arvlCd를 원문 문자열로 투영한다(열차 잠금 조인 키)", () => {
    const raw = {
      errorMessage: { code: "INFO-000", total: 1 },
      realtimeArrivalList: [
        { subwayId: "1005", updnLine: "상행", trainLineNm: "왕십리행", bstatnNm: "왕십리",
          btrainNo: "5696", arvlCd: "1", barvlDt: "0", arvlMsg2: "왕십리 도착",
          arvlMsg3: "왕십리", btrainSttus: "일반" },
      ],
    };
    const a = parseSubwayArrivals(raw, "왕십리")!.arrivals[0];
    expect(a.trainNo).toBe("5696");
    expect(a.arrivalCode).toBe("1");
  });

  it("btrainNo·arvlCd 결측이면 undefined(가짜 값 금지)", () => {
    const raw = {
      errorMessage: { code: "INFO-000", total: 1 },
      realtimeArrivalList: [
        { subwayId: "1002", updnLine: "내선", trainLineNm: "성수행", bstatnNm: "성수",
          barvlDt: "60", arvlMsg2: "곧 도착", btrainSttus: "일반" },
      ],
    };
    const a = parseSubwayArrivals(raw, "강남")!.arrivals[0];
    expect(a.trainNo).toBeUndefined();
    expect(a.arrivalCode).toBeUndefined();
  });
});

describe("resolveArrivalQueryName — 정식 표기 해석(B2 §6.3)", () => {
  it("seed 매칭 시 부역명 포함 정식 표기를 돌려준다", async () => {
    const { resolveArrivalQueryName } = await import("../providers/seoul-subway-arrival");
    expect(resolveArrivalQueryName("천호")).toBe("천호(풍납토성)");
    expect(resolveArrivalQueryName("천호역")).toBe("천호(풍납토성)");
    expect(resolveArrivalQueryName("군자")).toBe("군자(능동)");
  });

  it("seed 원문 입력(내 주변 경로)은 그대로 수렴한다", async () => {
    const { resolveArrivalQueryName } = await import("../providers/seoul-subway-arrival");
    expect(resolveArrivalQueryName("천호(풍납토성)")).toBe("천호(풍납토성)");
  });

  it("노선 힌트로 동명이역을 좁힌다(양평 5호선 vs 경의중앙선)", async () => {
    const { resolveArrivalQueryName } = await import("../providers/seoul-subway-arrival");
    // 5호선 양평과 경의중앙선 양평역은 별개 역 — 힌트 없이는 모호할 수 있으나
    // 두 seed 표기가 같으면("양평") 수렴, 다르면 원문 폴백이어야 한다.
    const hinted = resolveArrivalQueryName("양평역 5호선");
    expect(hinted).toBe("양평");
  });

  it("seed 미매칭이면 괄호를 보존한 채 노선 토큰·역 접미만 벗긴다", async () => {
    const { resolveArrivalQueryName } = await import("../providers/seoul-subway-arrival");
    expect(resolveArrivalQueryName("없는역이름(부역명) 5호선")).toBe("없는역이름(부역명)");
  });
});

describe("fetchSubwayArrivals — fetch + 장애 구분 + 정식 표기 폴백", () => {
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

  it("조회 URL은 정식 표기(부역명 포함)를 쓴다", async () => {
    const { fetchSubwayArrivals } = await import("../providers/seoul-subway-arrival");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(fixture));
    await fetchSubwayArrivals("천호");
    expect(String(spy.mock.calls[0][0])).toContain(encodeURIComponent("천호(풍납토성)"));
  });

  it("정식 표기 INFO-200 → 벗긴 표기로 1회 재조회(호환 폴백)", async () => {
    const { fetchSubwayArrivals } = await import("../providers/seoul-subway-arrival");
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok(EMPTY))
      .mockResolvedValueOnce(ok(fixture));
    const r = await fetchSubwayArrivals("천호");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[1][0])).toContain(encodeURIComponent("천호"));
    expect(String(spy.mock.calls[1][0])).not.toContain(encodeURIComponent("풍납토성"));
    expect(r!.arrivals.length).toBe(7);
  });

  it("정식 표기와 벗긴 표기가 같으면 재조회 없이 1회(INFO-200 = null)", async () => {
    const { fetchSubwayArrivals } = await import("../providers/seoul-subway-arrival");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(EMPTY));
    expect(await fetchSubwayArrivals("강동")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("표시 역명은 폴백 여부와 무관하게 벗긴 이름이다(조회 키·표시명 분리)", async () => {
    const { fetchSubwayArrivals } = await import("../providers/seoul-subway-arrival");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(fixture));
    const r = await fetchSubwayArrivals("천호");
    expect(r!.stationName).toBe("천호");
  });

  it("HTTP 실패 → throw(일시 장애 ≠ 정보 없음)", async () => {
    const { fetchSubwayArrivals } = await import("../providers/seoul-subway-arrival");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
    await expect(fetchSubwayArrivals("강남역")).rejects.toThrow();
  });
});
