import { describe, it, expect, vi, afterEach } from "vitest";
import type { SubwayStationArrivals } from "../types";
import fixture from "./fixtures/seoul-subway-arrival.json";

// env는 import 시점 동결 — 키 유무 분기를 위해 모킹(키 있음).
vi.mock("../env", () => ({
  env: { SEOUL_SUBWAY_REALTIME_KEY: "test-key" },
  hasSeoulSubwayRealtimeKey: () => true,
}));

import {
  buildNearbyArrivals,
  fetchNearbySubwayArrivals,
  type NearbyArrivalInput,
} from "../providers/subway-nearby";

const sample = (name: string): SubwayStationArrivals => ({
  stationName: name,
  arrivals: [
    {
      line: "2호선",
      direction: "상행",
      trainLineNm: "성수행",
      destination: "성수",
      message: "전역 도착",
      arrivalSeconds: 60,
      express: false,
    },
  ],
});

function ok(value: SubwayStationArrivals | null): NearbyArrivalInput {
  return {
    name: "강남역",
    lines: ["2호선"],
    distanceMeters: 120.7,
    result: { status: "fulfilled", value },
  };
}
function rejected(name = "역삼역"): NearbyArrivalInput {
  return {
    name,
    lines: ["2호선"],
    distanceMeters: 340.2,
    result: { status: "rejected", reason: new Error("HTTP 503") },
  };
}

describe("buildNearbyArrivals — 부분/전체 실패 투영(순수)", () => {
  it("fulfilled & 값 있음 → arrivalStatus ok, arrivals 보존 + 역명 cleanName + 거리 반올림", () => {
    const r = buildNearbyArrivals([ok(sample("강남"))]);
    expect(r).toHaveLength(1);
    expect(r[0].stationName).toBe("강남"); // "역" 접미사 제거
    expect(r[0].arrivalStatus).toBe("ok");
    expect(r[0].arrivals).toHaveLength(1);
    expect(r[0].distanceMeters).toBe(121); // 120.7 반올림
  });

  it("fulfilled & null(미커버 역) → 결과에서 제외(숨김)", () => {
    const r = buildNearbyArrivals([ok(null)]);
    expect(r).toEqual([]);
  });

  it("rejected → arrivalStatus unavailable, arrivals []('열차 없음'과 구분)", () => {
    const r = buildNearbyArrivals([ok(sample("강남")), rejected()]);
    expect(r).toHaveLength(2);
    const bad = r.find((s) => s.arrivalStatus === "unavailable")!;
    expect(bad).toBeTruthy();
    expect(bad.arrivals).toEqual([]);
  });

  it("시도가 전부 rejected → throw(일시 장애를 빈 결과로 위장 금지)", () => {
    expect(() => buildNearbyArrivals([rejected("A역"), rejected("B역")])).toThrow();
  });

  it("시도가 전부 null(비서울) → 빈 배열(graceful, throw 아님)", () => {
    expect(buildNearbyArrivals([ok(null), ok(null)])).toEqual([]);
  });

  it("ok + null 혼합 → ok만 남고 throw 안 함", () => {
    const r = buildNearbyArrivals([ok(sample("강남")), ok(null)]);
    expect(r).toHaveLength(1);
    expect(r[0].arrivalStatus).toBe("ok");
  });

  it("rejected + null 혼합 → throw (의도된 동작: reject는 '정보 없음'이 아니라 '미상')", () => {
    // swopenapi는 역명 무관 단일 서버라 reject는 "이 역이 서울 도시철도인지조차
    // 확인 못 한 일시 장애"를 뜻한다(특정 역의 '없음'이 아님). 성공(ok)이 0건이면
    // 이를 빈 섹션("주변 역 없음")으로 흡수하지 않고 throw→502로 올려야
    // "일시 장애 ≠ 정보 없음" 접근성 정본을 지킨다. null(비서울 확정)만으로
    // ok 0건을 '없음'으로 단정할 수 없다.
    expect(() => buildNearbyArrivals([rejected("A역"), ok(null)])).toThrow();
  });
});

describe("fetchNearbySubwayArrivals — seed 근접 + 실시간 합성", () => {
  afterEach(() => vi.restoreAllMocks());

  function res(json: unknown): Response {
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }

  it("강남역 좌표 + 실시간 정상 → 근접 서울역 도착(ok) 반환", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res(fixture));
    const r = await fetchNearbySubwayArrivals(37.497942, 127.027621);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((s) => s.arrivalStatus === "ok")).toBe(true);
    expect(r[0].arrivals.length).toBeGreaterThan(0);
  });

  it("INFO-200(비서울) 응답 → 전부 null → 빈 배열(graceful)", async () => {
    const EMPTY = { status: 500, code: "INFO-200", message: "해당하는 데이터가 없습니다." };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res(EMPTY));
    const r = await fetchNearbySubwayArrivals(37.497942, 127.027621);
    expect(r).toEqual([]);
  });

  it("실시간 HTTP 전부 실패 → throw(라우트 502)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);
    await expect(fetchNearbySubwayArrivals(37.497942, 127.027621)).rejects.toThrow();
  });

  it("바다 한가운데 등 근접역 없음(반경 밖) → 빈 배열", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await fetchNearbySubwayArrivals(35.0, 129.5); // 부산 앞바다(역 1km 밖)
    expect(r).toEqual([]);
    expect(spy).not.toHaveBeenCalled(); // 근접역 0 → 실시간 호출 자체가 없음
  });
});
