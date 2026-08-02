import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import realFixture from "./fixtures/seoul-culture-events.json";

// env는 import 시점 동결 — 서울 열린데이터 키 있음으로 모킹.
vi.mock("../env", () => ({
  env: { SEOUL_OPEN_DATA_KEY: "test-key" },
  hasSeoulOpenDataKey: () => true,
}));
// unstable_cache는 테스트에서 통과(캐시 없이 원함수 호출).
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

import {
  parseEventRows,
  isRunningOn,
  eventId,
  toCultureEvent,
  kstToday,
  fetchRunningEvents,
} from "../providers/seoul-culture-events";
import { findEventsNear, isEventServiceArea } from "../culture-events";

type Row = Record<string, unknown>;

/** 최소 유효 row — 각 테스트가 필요한 필드만 덮어쓴다. */
function row(over: Row = {}): Row {
  return {
    TITLE: "행사",
    PLACE: "장소",
    GUNAME: "중구",
    CODENAME: "전시/미술",
    DATE: "2026-08-01~2026-08-31",
    PRO_TIME: "10:00~18:00",
    USE_TRGT: "누구나",
    USE_FEE: "",
    IS_FREE: "무료",
    HMPG_ADDR: "https://culture.seoul.go.kr/culture/culture/cultureEvent/view.do?cultcode=158770",
    STRTDATE: "2026-08-01 00:00:00.0",
    END_DATE: "2026-08-31 00:00:00.0",
    LAT: "37.5665",
    LOT: "126.9780",
    ...over,
  };
}

/** 서울 열린데이터 정상 응답 봉투. */
function ok(rows: Row[], total = rows.length) {
  return {
    culturalEventInfo: {
      list_total_count: total,
      RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다" },
      row: rows,
    },
  };
}

/**
 * 진짜 `Response`를 쓴다 — 수제 목(`{ok, status, json}`)은 provider가 부르는
 * 메서드가 바뀌는 순간(`json()`→`text()`) 계약을 잘못 대변한다. `ok`는
 * status에서 파생되므로 인자로 받지 않는다. ⚠ body는 한 번만 읽히므로
 * 재사용 목은 `mockImplementation`으로 매 호출 새 Response를 만든다.
 */
function res(json: unknown, status = 200) {
  return new Response(JSON.stringify(json), { status });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseEventRows (서울 열린데이터 봉투 — datagokr 공용 파서 스코프 밖)", () => {
  it("정상 응답 → row 배열", () => {
    expect(parseEventRows(ok([row(), row()]))).toHaveLength(2);
  });

  it("row 부재·비배열·최상위 오류 봉투 → 빈 배열", () => {
    expect(parseEventRows({ culturalEventInfo: {} })).toEqual([]);
    expect(parseEventRows({ culturalEventInfo: { row: "" } })).toEqual([]);
    expect(parseEventRows({ RESULT: { CODE: "INFO-200" } })).toEqual([]);
    expect(parseEventRows(null)).toEqual([]);
  });

  it("실응답 fixture를 그대로 읽는다 (머지 게이트)", () => {
    const rows = parseEventRows(realFixture);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => typeof r.TITLE === "string" && r.TITLE)).toBe(true);
    expect(rows.every((r) => Number.isFinite(Number(r.LAT)))).toBe(true);
  });
});

describe("kstToday (서버 타임존 비의존)", () => {
  it("UTC 15:00 = KST 익일 00:00 → 날짜가 넘어간다", () => {
    expect(kstToday(Date.parse("2026-08-01T14:59:00Z"))).toBe("2026-08-01");
    expect(kstToday(Date.parse("2026-08-01T15:00:00Z"))).toBe("2026-08-02");
  });
});

describe("isRunningOn (진행 판정 — DATE 문자열 필터를 쓰지 않는 이유)", () => {
  const today = "2026-08-01";

  it("시작일 == 오늘 · 종료일 == 오늘 → 진행 중(양끝 포함)", () => {
    expect(isRunningOn(row({ STRTDATE: "2026-08-01 00:00:00.0" }), today)).toBe(true);
    expect(isRunningOn(row({ END_DATE: "2026-08-01 00:00:00.0" }), today)).toBe(true);
  });

  it("어제 끝난 행사 · 내일 시작 행사 → 제외", () => {
    expect(isRunningOn(row({ END_DATE: "2026-07-31 00:00:00.0" }), today)).toBe(false);
    expect(
      isRunningOn(row({ STRTDATE: "2026-08-02 00:00:00.0", END_DATE: "2026-08-09 00:00:00.0" }), today),
    ).toBe(false);
  });

  it("7월 시작 9월 종료(DATE 문자열엔 8월이 없다) → 진행 중", () => {
    // API의 DATE=2026-08 필터는 이 행사를 놓친다. 판정을 코드가 하는 이유.
    const spanning = row({
      DATE: "2026-07-01~2026-09-30",
      STRTDATE: "2026-07-01 00:00:00.0",
      END_DATE: "2026-09-30 00:00:00.0",
    });
    expect(isRunningOn(spanning, today)).toBe(true);
  });

  it("날짜 결측·형식 파손 → false (판정 불가를 진행 중으로 넣지 않는다)", () => {
    expect(isRunningOn(row({ STRTDATE: "" }), today)).toBe(false);
    expect(isRunningOn(row({ END_DATE: "곧 공지" }), today)).toBe(false);
  });
});

describe("eventId (안정 키)", () => {
  it("HMPG_ADDR의 cultcode가 정본", () => {
    expect(eventId(row())).toBe("seoul-158770");
  });

  it("cultcode 없으면 제목|장소|시작일 복합키로 폴백", () => {
    expect(eventId(row({ HMPG_ADDR: "https://example.com/x" }))).toBe("행사|장소|2026-08-01");
    expect(eventId(row({ HMPG_ADDR: "" }))).toBe("행사|장소|2026-08-01");
  });
});

describe("toCultureEvent (슬림 투영)", () => {
  it("무료면 fee를 싣지 않는다 (중복 낭독 금지)", () => {
    const e = toCultureEvent(row({ IS_FREE: "무료", USE_FEE: "전석 무료" }))!;
    expect(e.isFree).toBe(true);
    expect(e.fee).toBeUndefined();
  });

  it("유료면 요금 원문을 싣는다", () => {
    const e = toCultureEvent(row({ IS_FREE: "유료", USE_FEE: "R석 77,000원" }))!;
    expect(e.isFree).toBe(false);
    expect(e.fee).toBe("R석 77,000원");
  });

  it("좌표 비유한 · 제목 결측 → null (이름 없는 항목을 만들지 않는다)", () => {
    expect(toCultureEvent(row({ LAT: "" }))).toBeNull();
    expect(toCultureEvent(row({ LOT: "N/A" }))).toBeNull();
    expect(toCultureEvent(row({ TITLE: "  " }))).toBeNull();
  });

  it("link는 http로 시작할 때만 싣는다", () => {
    expect(toCultureEvent(row())!.link).toContain("https://");
    expect(toCultureEvent(row({ HMPG_ADDR: "준비중" }))!.link).toBeUndefined();
  });

  it("dateText는 원본 완성 표기를 그대로 (재조합 금지)", () => {
    expect(toCultureEvent(row())!.dateText).toBe("2026-08-01~2026-08-31");
  });
});

describe("fetchRunningEvents (전수 수집 — 안전한 절단선이 없다)", () => {
  const today = "2026-08-01";

  it("INFO-200(범위 밖 페이지) → 빈 배열, 오류 아님", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      res({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } }),
    );
    await expect(fetchRunningEvents(today)).resolves.toEqual([]);
  });

  it("그 밖의 코드·RESULT 부재 → throw (조회 실패와 0건을 구분)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockImplementation(async () => res({ RESULT: { CODE: "ERROR-500" } }));
    await expect(fetchRunningEvents(today)).rejects.toThrow(/ERROR-500/);
    spy.mockImplementation(async () => res({ culturalEventInfo: { row: [] } }));
    await expect(fetchRunningEvents(today)).rejects.toThrow(/RESULT.CODE 없음/);
  });

  it("HTTP 실패 → throw (상태코드를 메시지에 남긴다)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => res({}, 503));
    await expect(fetchRunningEvents(today)).rejects.toThrow(/HTTP 503/);
  });

  it("무효 키의 HTTP 200 + XML 본문 → 인증키를 지목하고 throw (SyntaxError 위장 금지)", async () => {
    // 따릉이·혼잡도와 같은 키를 쓰므로 키가 죽으면 셋이 동시에 같은 방식으로 오진된다.
    const xml =
      "<RESULT><CODE>INFO-100</CODE><MESSAGE><![CDATA[인증키가 유효하지 않습니다.]]></MESSAGE></RESULT>";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(xml, { status: 200 }),
    );
    await expect(fetchRunningEvents(today)).rejects.toThrow(/INFO-100.*인증키/);
  });

  it("첫 페이지가 가득 차면 뒤 페이지까지 받아 진행 중만 남긴다", async () => {
    // 1페이지: 1,000건 전부 과거(진행 중 0). 2페이지: 1건만 진행 중.
    const past = row({ STRTDATE: "2025-01-01 00:00:00.0", END_DATE: "2025-01-02 00:00:00.0" });
    const page1 = Array.from({ length: 1000 }, () => past);
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(res(ok(page1, 1001)));
    spy.mockResolvedValueOnce(res(ok([row({ TITLE: "진행중" })], 1001)));
    const out = await fetchRunningEvents(today);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.map((e) => e.title)).toEqual(["진행중"]);
  });

  it("뒤 페이지의 INFO-200도 오류가 아니라 끝 신호다", async () => {
    // 첫 페이지 정책만 테스트하면 뒤 페이지 경로가 조용히 썩는다(변이 주입으로 확인).
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(res(ok(Array.from({ length: 1000 }, () => row()), 999_999)));
    spy.mockImplementation(async () => res({ RESULT: { CODE: "INFO-200" } }));
    const out = await fetchRunningEvents(today);
    expect(out).toHaveLength(1000); // 1페이지분만, 예외 없이
  });

  it("첫 페이지가 덜 찼으면 더 부르지 않는다 (종료 조건은 받은 row 수)", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => res(ok([row()], 999_999))); // total 힌트가 거짓이어도
    const out = await fetchRunningEvents(today);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
  });
});

describe("findEventsNear (거리·반경·정렬·total)", () => {
  const NOW = Date.parse("2026-08-01T03:00:00Z");
  /** 시청 기준 대략 남쪽으로 벌어지는 좌표 3개(가까운 → 먼 순서를 뒤섞어 넣는다). */
  const near = row({ TITLE: "가까움", LAT: "37.5665", LOT: "126.9780" });
  const mid = row({ TITLE: "중간", LAT: "37.5575", LOT: "126.9780" }); // ~1.0km
  const far = row({ TITLE: "멀다", LAT: "37.5420", LOT: "126.9780" }); // ~2.7km(반경 내)
  const outside = row({ TITLE: "반경밖", LAT: "37.4979", LOT: "127.0276" }); // 강남역

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => res(ok([far, near, outside, mid])));
  });

  it("거리 오름차순으로 정렬한다", async () => {
    const { events } = await findEventsNear(37.5665, 126.978, { nowMs: NOW });
    expect(events.map((e) => e.title)).toEqual(["가까움", "중간", "멀다"]);
    expect(events[0].distanceMeters).toBeLessThan(events[1].distanceMeters);
  });

  it("반경 3km 밖은 제외하고, total은 반경 내 전체 수", async () => {
    const { events, total } = await findEventsNear(37.5665, 126.978, { nowMs: NOW });
    expect(events.some((e) => e.title === "반경밖")).toBe(false);
    expect(total).toBe(3);
  });

  it("서버 캡 50을 넘으면 잘리되 total은 절단 전 수를 유지한다", async () => {
    // 캡보다 적은 fixture만 쓰면 "total을 캡 이후 길이로 계산" 변이를 못 잡는다.
    const many = Array.from({ length: 60 }, (_, i) =>
      row({ TITLE: `행사${i}`, LAT: String(37.5665 - i * 0.0001), LOT: "126.9780" }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => res(ok(many)));
    const { events, total } = await findEventsNear(37.5665, 126.978, { nowMs: NOW });
    expect(events).toHaveLength(50);
    expect(total).toBe(60);
  });

  it("반경을 좁히면 그만큼만 남는다", async () => {
    const { events, total } = await findEventsNear(37.5665, 126.978, {
      nowMs: NOW,
      radiusMeters: 500,
    });
    expect(events.map((e) => e.title)).toEqual(["가까움"]);
    expect(total).toBe(1);
  });
});

describe("isEventServiceArea", () => {
  it("서울 안은 서비스권", () => {
    expect(isEventServiceArea(37.5665, 126.978)).toBe(true);
  });

  it("서울 인접은 서비스권 — 실제로 서울 행사가 반경 3km에 잡힌다", () => {
    // 2026-08-02 실호출: 하남 미사·과천 각 1건. 시도로 잘랐다면 사라졌을 결과다.
    expect(isEventServiceArea(37.562, 127.193)).toBe(true);
    expect(isEventServiceArea(37.4292, 126.9877)).toBe(true);
  });

  it("지방은 미제공 — '오늘 행사 없음'으로 위장하지 않는다", () => {
    expect(isEventServiceArea(35.1578, 129.0594)).toBe(false); // 부산
    expect(isEventServiceArea(35.8659, 128.5936)).toBe(false); // 대구
    expect(isEventServiceArea(33.4996, 126.5312)).toBe(false); // 제주
  });
});
