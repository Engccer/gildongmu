import { describe, it, expect, vi, afterEach } from "vitest";

// env는 import 시점에 process.env로 동결되므로, fetchStationTimetable의 키
// 유무 분기를 테스트하려면 env 모듈을 모킹해 키를 주입한다. 이 파일은
// src/lib/providers/__tests__/에 있어 src/lib/env.ts까지 두 단계 위(../../env).
vi.mock("../../env", () => ({ env: { DATA_GO_KR_API_KEY: "test-key" } }));

import {
  displayLineName,
  computeServiceDailyType, deriveFirstLast, fetchStationTimetable,
} from "../tago-subway";

describe("displayLineName", () => {
  it("축약 노선명에 선을 붙인다", () => {
    expect(displayLineName("5호선")).toBe("5호선");
    expect(displayLineName("수인분당")).toBe("수인분당선");
    expect(displayLineName("GTX-A")).toBe("GTX-A선");
  });
});

describe("computeServiceDailyType — KST-3h 서비스데이", () => {
  it("월요일 00:30 KST는 일요일 타입", () => {
    // 2026-07-27(월) 00:30 KST = 2026-07-26T15:30Z
    expect(computeServiceDailyType(Date.UTC(2026, 6, 26, 15, 30)).type).toBe("sunday");
  });
  it("월요일 05:00 KST는 평일 타입", () => {
    expect(computeServiceDailyType(Date.UTC(2026, 6, 26, 20, 0)).type).toBe("weekday");
  });
  it("토요일 낮은 saturday", () => {
    // 2026-07-25(토) 12:00 KST = 03:00Z
    expect(computeServiceDailyType(Date.UTC(2026, 6, 25, 3, 0)).type).toBe("saturday");
  });
});

const SELF = "MTRS152549";
const row = (dep: string, end = "MTRS152531", endNm = "애오개") => ({
  subwayStationId: SELF, endSubwayStationId: end, endSubwayStationNm: endNm, depTime: dep,
});

describe("deriveFirstLast", () => {
  it("심야(<03시)를 +24h 보정해 첫차가 05시대가 된다", () => {
    const r = deriveFirstLast([row("002450"), row("051310", "MTRS152501", "방화"), row("235150")], SELF)!;
    expect(r.first).toEqual({ time: "05:13", terminus: "방화" });
    expect(r.last).toEqual({ time: "00:24", nextDay: true, terminus: "애오개" });
  });
  it("당역 종착·비정상 depTime을 제외한다", () => {
    const r = deriveFirstLast([row("000210", SELF, "강동"), row("abc"), row("051310")], SELF)!;
    expect(r.first.time).toBe("05:13");
    expect(r.last.time).toBe("05:13");
  });
  it("유효 행 0이면 null", () => {
    expect(deriveFirstLast([row("000210", SELF, "강동")], SELF)).toBeNull();
  });
});

// --- fetchStationTimetable: 판정 표(스펙 §2-A) 5행 + lineHint ---------------

function ok(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as unknown as Response;
}

/** data.go.kr 표준 envelope. items 0건이면 ""(빈 결과), 1건이면 객체, 다건이면 배열. */
function envelope(items: unknown[]): unknown {
  return {
    response: {
      header: { resultCode: "00" },
      body: {
        totalCount: items.length,
        items: items.length === 0 ? "" : { item: items.length === 1 ? items[0] : items },
      },
    },
  };
}

// 특일정보(공휴일) 호출은 매 시나리오에서 공통으로 나가므로 "그 달 공휴일
// 없음"으로 응답해 dailyType이 요일 그대로 나오게 고정한다(holiday 자체 계약은
// holiday.test.ts가 별도 검증).
const NO_HOLIDAY = ok({ response: { header: { resultCode: "00" }, body: { items: "" } } });

function opFromUrl(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname.split("/").pop() ?? "";
}

const LINE5_ID = "MTRS152549";
const line5Keyword = { subwayStationId: LINE5_ID, subwayStationName: "강동", subwayRouteName: "5호선" };

describe("fetchStationTimetable — 판정 표(스펙 §2-A)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("시나리오 A: 両방향 성공 → directions 2, partial 없음", async () => {
    const upRow = { endSubwayStationId: "MTRS152501", endSubwayStationNm: "방화", depTime: "051310" };
    const downRow = { endSubwayStationId: "MTRS152531", endSubwayStationNm: "애오개", depTime: "234500" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const op = opFromUrl(input);
        if (op === "getRestDeInfo") return NO_HOLIDAY;
        if (op === "GetKwrdFndSubwaySttnList") return ok(envelope([line5Keyword]));
        if (op === "GetSubwaySttnAcctoSchdulList") {
          const url = new URL(String(input));
          const dir = url.searchParams.get("upDownTypeCode");
          return ok(envelope([dir === "U" ? upRow : downRow]));
        }
        throw new Error(`예상 밖 오퍼레이션: ${op}`);
      }),
    );
    const result = await fetchStationTimetable("강동역 5호선");
    expect(result).not.toBeNull();
    expect(result!.partial).toBeUndefined();
    expect(result!.lines.length).toBe(1);
    expect(result!.lines[0].lineName).toBe("5호선");
    expect(result!.lines[0].directions.length).toBe(2);
  });

  it("시나리오 B: 상행 성공·하행 실패 → partial:true, directions는 상행만", async () => {
    const upRow = { endSubwayStationId: "MTRS152501", endSubwayStationNm: "방화", depTime: "051310" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const op = opFromUrl(input);
        if (op === "getRestDeInfo") return NO_HOLIDAY;
        if (op === "GetKwrdFndSubwaySttnList") return ok(envelope([line5Keyword]));
        if (op === "GetSubwaySttnAcctoSchdulList") {
          const url = new URL(String(input));
          const dir = url.searchParams.get("upDownTypeCode");
          if (dir === "D") throw new Error("network down");
          return ok(envelope([upRow]));
        }
        throw new Error(`예상 밖 오퍼레이션: ${op}`);
      }),
    );
    const result = await fetchStationTimetable("강동역 5호선");
    expect(result).not.toBeNull();
    expect(result!.partial).toBe(true);
    expect(result!.lines[0].directions.length).toBe(1);
    expect(result!.lines[0].directions[0].direction).toBe("up");
  });

  it("시나리오 C: 両방향 실패 → throw(무운행으로 위장 금지)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const op = opFromUrl(input);
        if (op === "getRestDeInfo") return NO_HOLIDAY;
        if (op === "GetKwrdFndSubwaySttnList") return ok(envelope([line5Keyword]));
        throw new Error("network down");
      }),
    );
    await expect(fetchStationTimetable("강동역 5호선")).rejects.toThrow();
  });

  it("시나리오 D: 両방향 성공·유효 행 0(전부 당역종착) → lines:[]", async () => {
    const terminusRow = { endSubwayStationId: LINE5_ID, endSubwayStationNm: "강동", depTime: "051310" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const op = opFromUrl(input);
        if (op === "getRestDeInfo") return NO_HOLIDAY;
        if (op === "GetKwrdFndSubwaySttnList") return ok(envelope([line5Keyword]));
        if (op === "GetSubwaySttnAcctoSchdulList") return ok(envelope([terminusRow]));
        throw new Error(`예상 밖 오퍼레이션: ${op}`);
      }),
    );
    const result = await fetchStationTimetable("강동역 5호선");
    expect(result).not.toBeNull();
    expect(result!.partial).toBeUndefined();
    expect(result!.lines).toEqual([]);
  });

  it("시나리오 E: 키워드 정확매칭 0건(다른 역만) → null, 시간표 호출 없음", async () => {
    let scheduleCalled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const op = opFromUrl(input);
        if (op === "getRestDeInfo") return NO_HOLIDAY;
        if (op === "GetKwrdFndSubwaySttnList") {
          // "강동역" 질의인데 "강동구청"만 온다 — 정확매칭 필터가 걸러야 한다.
          return ok(envelope([{ subwayStationId: "X", subwayStationName: "강동구청", subwayRouteName: "5호선" }]));
        }
        if (op === "GetSubwaySttnAcctoSchdulList") scheduleCalled = true;
        throw new Error(`예상 밖 오퍼레이션: ${op}`);
      }),
    );
    const result = await fetchStationTimetable("강동역");
    expect(result).toBeNull();
    expect(scheduleCalled).toBe(false);
  });

  it("lineHint: 동명이역 2노선 중 힌트와 일치하는 노선만 조회", async () => {
    const YP5_ID = "MTRS111111"; // 양평역(5호선)
    const KJJ_ID = "MTRS999999"; // 양평역(경의중앙선, 동명이역)
    const requestedIds: string[] = [];
    const upRow = { endSubwayStationId: "MTRS152501", endSubwayStationNm: "방화", depTime: "051310" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const op = opFromUrl(input);
        if (op === "getRestDeInfo") return NO_HOLIDAY;
        if (op === "GetKwrdFndSubwaySttnList") {
          return ok(
            envelope([
              { subwayStationId: YP5_ID, subwayStationName: "양평", subwayRouteName: "5호선" },
              { subwayStationId: KJJ_ID, subwayStationName: "양평", subwayRouteName: "경의중앙선" },
            ]),
          );
        }
        if (op === "GetSubwaySttnAcctoSchdulList") {
          const url = new URL(String(input));
          requestedIds.push(url.searchParams.get("subwayStationId")!);
          return ok(envelope([upRow]));
        }
        throw new Error(`예상 밖 오퍼레이션: ${op}`);
      }),
    );
    const result = await fetchStationTimetable("양평역 5호선");
    expect(result).not.toBeNull();
    expect(result!.lines.length).toBe(1);
    expect(result!.lines[0].lineName).toBe("5호선");
    // 경의중앙선(KJJ_ID)으로는 한 번도 조회하지 않는다.
    expect(requestedIds.every((id) => id === YP5_ID)).toBe(true);
    expect(requestedIds).not.toContain(KJJ_ID);
  });
});

describe("fetchScheduleRows 폴백 — 토요일 다이어 부재(실호출 2026-08-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** 2026-08-01(토) 09:00 KST. computeServiceDailyType이 "saturday"를 내는 시각. */
  function freezeSaturday() {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-01T00:00:00Z"));
  }

  const upRow = { endSubwayStationId: "OTHER", endSubwayStationNm: "방화", depTime: "053700" };

  it("토요일 코드가 빈 결과면 휴일 코드로 다시 묻고 기준을 휴일로 표기한다", async () => {
    // 수도권 운영사는 02(토요일) 다이어를 제출하지 않는다 — 정상 응답 + 0행이다.
    // 폴백이 없으면 lines가 비어 섹션이 통째로 사라진다(선재 결함).
    freezeSaturday();
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const op = opFromUrl(input);
        if (op === "getRestDeInfo") return NO_HOLIDAY;
        if (op === "GetKwrdFndSubwaySttnList") return ok(envelope([line5Keyword]));
        if (op === "GetSubwaySttnAcctoSchdulList") {
          const code = new URL(String(input)).searchParams.get("dailyTypeCode")!;
          asked.push(code);
          return ok(envelope(code === "02" ? [] : [upRow]));
        }
        throw new Error(`예상 밖 오퍼레이션: ${op}`);
      }),
    );
    const result = await fetchStationTimetable("강동역 5호선");
    expect(asked).toContain("02");
    expect(asked).toContain("03");
    expect(result!.lines[0].directions.length).toBe(2);
    expect(result!.dailyType).toBe("sunday"); // 답한 다이어를 그대로 표기
  });

  it("토요일 다이어를 가진 지역은 폴백하지 않고 토요일 기준을 유지한다", async () => {
    // 부산 1호선은 02도 164행이다(실호출). 지역별로 갈리므로 일괄 폴백은 거짓이 된다.
    freezeSaturday();
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const op = opFromUrl(input);
        if (op === "getRestDeInfo") return NO_HOLIDAY;
        if (op === "GetKwrdFndSubwaySttnList") return ok(envelope([line5Keyword]));
        if (op === "GetSubwaySttnAcctoSchdulList") {
          asked.push(new URL(String(input)).searchParams.get("dailyTypeCode")!);
          return ok(envelope([upRow]));
        }
        throw new Error(`예상 밖 오퍼레이션: ${op}`);
      }),
    );
    const result = await fetchStationTimetable("강동역 5호선");
    expect(asked.every((c) => c === "02")).toBe(true);
    expect(result!.dailyType).toBe("saturday");
  });

  it("한 노선이라도 토요일에 답하면 역 전체가 폴백하지 않는다 (혼합 사업자 환승역)", async () => {
    // 실측 2026-08-01: 대저역은 부산3호선이 토요일 150행인데 부산김해경전철은 0행이다.
    // 구간 단위로 폴백하면 "토요일 기준" 라벨 아래 휴일 값이 섞여 라벨이 거짓이 된다.
    freezeSaturday();
    const asked: string[] = [];
    const line3 = { subwayStationId: "MTRBS3301", subwayStationName: "대저", subwayRouteName: "3호선" };
    const gimhae = { subwayStationId: "MTRBGB10101", subwayStationName: "대저", subwayRouteName: "부산김해경전철" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const op = opFromUrl(input);
        if (op === "getRestDeInfo") return NO_HOLIDAY;
        if (op === "GetKwrdFndSubwaySttnList") return ok(envelope([line3, gimhae]));
        if (op === "GetSubwaySttnAcctoSchdulList") {
          const url = new URL(String(input));
          asked.push(url.searchParams.get("dailyTypeCode")!);
          const id = url.searchParams.get("subwayStationId")!;
          return ok(envelope(id === line3.subwayStationId ? [upRow] : []));
        }
        throw new Error(`예상 밖 오퍼레이션: ${op}`);
      }),
    );
    const result = await fetchStationTimetable("대저");
    // 03으로 재조회하지 않는다 — 이 역은 토요일 다이어를 갖는 역이다.
    expect(asked.every((c) => c === "02")).toBe(true);
    expect(result!.dailyType).toBe("saturday"); // 남은 노선에 대해 참
    // 토요일에 답하지 못한 노선은 휴일 값으로 메우지 않고 정직하게 빠진다.
    expect(result!.lines.map((l) => l.lineName)).toEqual(["3호선"]);
  });

});
