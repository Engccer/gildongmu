import { describe, it, expect, vi, afterEach } from "vitest";
import type { StationTimetable, SubwayStationArrivals } from "../types";
import fixture from "./fixtures/seoul-subway-arrival.json";

// env는 import 시점 동결 — 키 유무 분기를 위해 모킹(키 있음).
vi.mock("../env", () => ({
  env: { SEOUL_SUBWAY_REALTIME_KEY: "test-key" },
  hasSeoulSubwayRealtimeKey: () => true,
}));

import {
  buildNearbyArrivals,
  fetchNearbySubwayArrivals,
  judgeStationService,
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

/** 한 노선의 방향별 첫차·막차만 갖춘 최소 시간표. */
function timetable(
  windows: Array<{ first: string; last: string }>,
  opts: { partial?: true } = {},
): StationTimetable {
  return {
    stationName: "강남",
    dailyType: "weekday",
    ...(opts.partial ? { partial: opts.partial } : {}),
    lines: [
      {
        lineName: "2호선",
        directions: windows.map((w, i) => ({
          direction: i === 0 ? ("up" as const) : ("down" as const),
          first: { time: w.first, terminus: "종착" },
          last: { time: w.last, terminus: "종착" },
        })),
      },
    ],
  };
}

describe("judgeStationService — '운행이 끝났다'는 단정의 조건(순수)", () => {
  it("첫차 전 새벽 → closed + 가장 이른 첫차(환승역은 노선마다 다르다)", () => {
    const r = judgeStationService(
      timetable([{ first: "05:32", last: "00:03" }, { first: "05:40", last: "23:50" }]),
      4 * 60,
    );
    expect(r).toEqual({ closed: true, firstTime: "05:32" });
  });

  it("운행 중 시각은 closed가 아니다", () => {
    expect(judgeStationService(timetable([{ first: "05:32", last: "00:03" }]), 12 * 60).closed)
      .toBe(false);
  });

  it("자정을 넘기는 막차 구간(05:32~00:03)의 23:30을 운행 중으로 읽는다", () => {
    // 분으로만 비교하면 막차 00:03이 3이라 밖으로 오판한다
    expect(
      judgeStationService(timetable([{ first: "05:32", last: "00:03" }]), 23 * 60 + 30).closed,
    ).toBe(false);
  });

  it("한 방향이라도 운행 중이면 단정하지 않는다", () => {
    const r = judgeStationService(
      timetable([{ first: "05:32", last: "23:00" }, { first: "05:40", last: "00:30" }]),
      23 * 60 + 30,
    );
    expect(r.closed).toBe(false);
  });

  it("시간표 없음 → 판정 불가(미커버 역과 조회 실패를 구분하지 않는다)", () => {
    expect(judgeStationService(null, 4 * 60).closed).toBe(false);
  });

  it("partial 시간표 → 판정 불가(빠진 노선이 운행 중일 수 있다)", () => {
    const r = judgeStationService(
      timetable([{ first: "05:32", last: "00:03" }], { partial: true }),
      4 * 60,
    );
    expect(r.closed).toBe(false);
  });

  it("시각 형식이 깨진 창만 있으면 판정 불가", () => {
    expect(judgeStationService(timetable([{ first: "??:??", last: "!!:!!" }]), 4 * 60).closed)
      .toBe(false);
  });
});

describe("buildNearbyArrivals — 부분/전체 실패 투영(순수)", () => {
  it("fulfilled & 값 있음 → arrivalStatus ok, arrivals 보존 + 역명 cleanName + 거리 반올림", () => {
    const r = buildNearbyArrivals([ok(sample("강남"))]);
    expect(r).toHaveLength(1);
    expect(r[0].stationName).toBe("강남"); // "역" 접미사 제거
    expect(r[0].arrivalStatus).toBe("ok");
    expect(r[0].arrivals).toHaveLength(1);
    expect(r[0].distanceMeters).toBe(121); // 120.7 반올림
  });

  it("fulfilled & null + 운행 시간 밖 확정 → closed + 첫차(역은 남는다)", () => {
    const r = buildNearbyArrivals([
      { ...ok(null), service: { closed: true, firstTime: "05:32" } },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].arrivalStatus).toBe("closed");
    expect(r[0].firstTime).toBe("05:32");
  });

  it("fulfilled & null + 판정 불가 → unknown(역은 남는다)", () => {
    const r = buildNearbyArrivals([ok(null)]);
    expect(r).toHaveLength(1);
    expect(r[0].stationName).toBe("강남");
    expect(r[0].arrivalStatus).toBe("unknown");
    expect(r[0].arrivals).toEqual([]);
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

  it("실시간이 전부 비어도 역은 전부 남는다(심야 '역 없음' 오낭독 회귀 가드)", () => {
    // 종전에는 여기서 빈 배열이 나왔고, 화면이 그것을 "주변에 지하철역이
    // 없습니다"로 읽었다(위원장 지적 2026-08-02). 근접역은 정적 seed 산출이라
    // 시각과 무관하게 참이므로 그 낭독은 거짓이었다.
    const r = buildNearbyArrivals([ok(null), ok(null)]);
    expect(r).toHaveLength(2);
    expect(r.every((s) => s.arrivalStatus === "unknown")).toBe(true);
  });

  it("ok + null 혼합 → 둘 다 남고 상태만 갈린다", () => {
    const r = buildNearbyArrivals([ok(sample("강남")), ok(null)]);
    expect(r.map((s) => s.arrivalStatus)).toEqual(["ok", "unknown"]);
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

  it("INFO-200 응답(심야·미커버) → 역은 남고 unknown(빈 배열 아님)", async () => {
    // 시간표 키가 없는 환경이라 판정은 불가 → closed로 단정하지 않고 unknown.
    const EMPTY = { status: 500, code: "INFO-200", message: "해당하는 데이터가 없습니다." };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res(EMPTY));
    const r = await fetchNearbySubwayArrivals(37.497942, 127.027621);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((s) => s.arrivalStatus === "unknown")).toBe(true);
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
