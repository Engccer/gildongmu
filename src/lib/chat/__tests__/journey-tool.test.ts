// E70-b — 채팅 도구 plan_journey: 후보 추출·역 선정(순수)과 실행부의 턴 규칙·한도 마커·3-state.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JourneyResult, Place, TransitLeg, TransitRoute } from "@/lib/types";
import type { ExecutionContext } from "../types";

vi.mock("@/lib/providers/places", () => ({ searchPlaces: vi.fn() }));
vi.mock("@/lib/providers/odsay", () => ({ getTransitRoute: vi.fn() }));
vi.mock("@/lib/journey/query", () => ({ queryJourney: vi.fn() }));
vi.mock("@/lib/journey/stop-search", () => ({ searchJourneyStops: vi.fn(), stopSearchDeps: {} }));
vi.mock("@/lib/env", async (orig) => ({
  ...(await orig<typeof import("@/lib/env")>()),
  hasDataGoKrKey: vi.fn(() => true),
}));

import { executeFunction } from "../router";
import {
  journeyStationCandidates,
  journeySummary,
  pickJourneyStation,
  pickJourneyStop,
} from "../journey-tool";
import { searchPlaces } from "@/lib/providers/places";
import { getTransitRoute } from "@/lib/providers/odsay";
import { queryJourney } from "@/lib/journey/query";
import { searchJourneyStops } from "@/lib/journey/stop-search";
import { hasDataGoKrKey } from "@/lib/env";

const mockSearch = vi.mocked(searchPlaces);
const mockTransit = vi.mocked(getTransitRoute);
const mockQuery = vi.mocked(queryJourney);
const mockStops = vi.mocked(searchJourneyStops);

const GILDONG = { lat: 37.5378, lng: 127.1417 };
const SUBWAY = "교통,수송 > 지하철,전철 > ";

function place(name: string, lat: number, lng: number, category = ""): Place {
  return { id: name, name, category, address: "", roadAddress: "", lat, lng };
}
const DEST = place("여의도공원", 37.5262, 126.9226);
const SINDORIM_1 = place("신도림역 1호선", 37.5088, 126.8912, `${SUBWAY}수도권1호선`);
const SINDORIM_2 = place("신도림역 2호선", 37.5089, 126.8913, `${SUBWAY}수도권2호선`);
// 동명 이역: 서울 5호선 양평역과 경기 양평군 경의중앙선 양평역(40km 넘게 떨어져 있다).
const YANGPYEONG_5 = place("양평역 5호선", 37.5256, 126.8862, `${SUBWAY}수도권5호선`);
const YANGPYEONG_GJ = place("양평역 경의중앙선", 37.4927, 127.4918, `${SUBWAY}경의중앙선`);

function leg(mode: TransitLeg["mode"], lineName?: string, fromName?: string, toName?: string): TransitLeg {
  return { mode, minutes: 5, ...(lineName ? { lineName } : {}), ...(fromName ? { fromName } : {}), ...(toName ? { toName } : {}) };
}
function route(legs: TransitLeg[]): TransitRoute {
  return { summary: { totalMinutes: 40, fare: 1500, transfers: 1, walkMinutes: 5 }, legs, routeKey: "r0" };
}
const TWO_LINES = route([
  leg("walk"),
  leg("subway", "수도권 5호선", "길동", "천호(풍납토성)"),
  leg("walk"),
  leg("subway", "수도권 8호선", "천호(풍납토성)", "잠실"),
  leg("walk"),
]);

const JOURNEY: JourneyResult = {
  variants: [
    {
      kind: "designated",
      boardStation: { name: "신도림", coord: { lat: 37.5088, lng: 126.8912 } },
      alightStation: { name: "여의도", coord: { lat: 37.5216, lng: 126.9243 } },
      taxiIn: { distanceMeters: 9000, durationSeconds: 1500, taxiFare: 14000, tollFare: 0, guides: [] } as never,
      transit: route([leg("walk"), leg("subway", "수도권 1호선", "신도림", "여의도"), leg("walk")]),
      totals: { minutes: 42, taxiFare: 14000, transitFare: 1500 },
    },
  ],
};

function ctxWith(over: Partial<NonNullable<ExecutionContext["journey"]>> = {}, base: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    locale: "ko",
    dataLocale: "ko",
    userLocation: GILDONG,
    journey: { clientIp: "1.2.3.4", manualOrigin: false, turn: { asked: false, queried: false }, ...over },
    ...base,
  };
}

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockImplementation(async ({ query }) => {
    const places =
      query === "여의도공원" ? [DEST]
      : query === "신도림역" ? [place("신도림동", 37.5, 126.88), SINDORIM_1, SINDORIM_2]
      : query === "양평역" ? [YANGPYEONG_5, YANGPYEONG_GJ]
      : [];
    return { places } as never;
  });
  mockTransit.mockReset();
  mockTransit.mockResolvedValue({ recommended: TWO_LINES, alternatives: [], totalCandidates: 1 });
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ kind: "ok", result: JOURNEY });
  mockStops.mockReset();
  vi.mocked(hasDataGoKrKey).mockReturnValue(true);
});

/** 후보의 정류 좌표가 없거나 멀어 거리 거르기에 걸리지 않는 끝점. */
const FAR_ENDS = { origin: { lat: 35.1, lng: 129.0 }, dest: { lat: 35.2, lng: 129.1 } };

describe("journeyStationCandidates — 걸어갈 거리의 역은 후보가 아니다", () => {
  const stops = (lat: number, lng: number) => [{ name: "가", lat, lng }, { name: "나", lat: lat + 0.05, lng }] as never;
  const withStops = route([{ ...leg("subway", "수도권 1호선", "시청", "수원"), stops: stops(37.5657, 126.9769) }]);
  it("승차 후보: 출발지에서 500m 안의 승차역은 뺀다", () => {
    const origin = { lat: 37.5663, lng: 126.9779 };
    expect(journeyStationCandidates(withStops, "board", { origin, dest: FAR_ENDS.dest })).toEqual([]);
    expect(journeyStationCandidates(withStops, "board", FAR_ENDS).map((c) => c.name)).toEqual(["시청역"]);
  });
  it("하차 후보: 목적지에서 500m 안의 하차역은 뺀다", () => {
    const dest = { lat: 37.6157, lng: 126.9769 };
    expect(journeyStationCandidates(withStops, "alight", { origin: FAR_ENDS.origin, dest })).toEqual([]);
    expect(journeyStationCandidates(withStops, "alight", FAR_ENDS).map((c) => c.name)).toEqual(["수원역"]);
  });
});

describe("journeyStationCandidates — 후보는 대중교통 경로에서만(D4)", () => {
  it("board: 첫 승차역과 환승역(마지막 하차역 제외), 구간의 노선과 함께", () => {
    expect(journeyStationCandidates(TWO_LINES, "board", FAR_ENDS)).toEqual([
      { name: "길동역", line: "5호선", side: "board" },
      { name: "천호(풍납토성)역", line: "8호선", side: "board" },
    ]);
  });

  it("alight: 환승역과 마지막 하차역(첫 승차역 제외)", () => {
    expect(journeyStationCandidates(TWO_LINES, "alight", FAR_ENDS)).toEqual([
      { name: "천호(풍납토성)역", line: "5호선", side: "alight" },
      { name: "잠실역", line: "8호선", side: "alight" },
    ]);
  });

  it("쪽을 모르면 두 묶음을 side 표지로 갈라 함께 싣는다", () => {
    const all = journeyStationCandidates(TWO_LINES, undefined, FAR_ENDS);
    expect(all.map((c) => `${c.side}:${c.name}`)).toEqual(["board:길동역", "board:천호(풍납토성)역", "alight:천호(풍납토성)역", "alight:잠실역"]);
  });

  it("버스만 타는 경로와 경로 없음은 빈 목록", () => {
    expect(journeyStationCandidates(route([leg("walk"), leg("bus", "341", "길동사거리", "여의도환승센터")]), "board", FAR_ENDS)).toEqual([]);
    expect(journeyStationCandidates(route([leg("bus", "341", "가", "나")]), undefined, FAR_ENDS)).toEqual([]);
    expect(journeyStationCandidates(null, "alight", FAR_ENDS)).toEqual([]);
  });

  it("버스 구간의 정류장은 후보가 아니다(지하철 구간만)", () => {
    const mixed = route([leg("bus", "341", "길동사거리", "천호역"), leg("subway", "수도권 5호선", "천호", "여의도")]);
    expect(journeyStationCandidates(mixed, "board", FAR_ENDS)).toEqual([{ name: "천호역", line: "5호선", side: "board" }]);
  });

  it("한쪽에 최대 3곳, 경로 순서", () => {
    const four = route(["가", "나", "다", "라"].map((n, i) => leg("subway", `수도권 ${i + 1}호선`, n, `${n}끝`)));
    expect(journeyStationCandidates(four, "board", FAR_ENDS).map((c) => c.name)).toEqual(["가역", "나역", "다역"]);
  });
});

describe("pickJourneyStation — 역 이름 선정(D3)", () => {
  it("역이 아닌 결과와 이름이 다른 역은 보지 않는다", () => {
    const r = pickJourneyStation("신도림", undefined, [place("신도림동", 37.5, 126.88), place("구로역 1호선", 37.5, 126.88, `${SUBWAY}수도권1호선`)], GILDONG);
    expect(r).toEqual({ kind: "notFound" });
  });

  it("노선이 있으면 그 노선의 역", () => {
    const r = pickJourneyStation("신도림역", "2호선", [SINDORIM_1, SINDORIM_2], GILDONG);
    expect(r).toEqual({ kind: "found", station: { label: "신도림역 2호선", lat: 37.5089, lng: 126.8913, line: "수도권2호선" } });
  });

  it("이름 뒤 노선 토큰도 노선으로 읽는다", () => {
    const r = pickJourneyStation("양평역 5호선", undefined, [YANGPYEONG_5, YANGPYEONG_GJ], GILDONG);
    expect(r.kind === "found" && r.station.label).toBe("양평역 5호선");
  });

  it("노선이 없으면 기준 좌표에 가장 가까운 것(같은 자리의 환승역은 되묻지 않는다)", () => {
    const near2 = { lat: 37.5089, lng: 126.8913 };
    const r = pickJourneyStation("신도림역", undefined, [SINDORIM_1, SINDORIM_2], near2);
    // 노선을 말하지 않았으면 노선으로 좁히지 않는다(이름만, 좌표는 가장 가까운 줄의 것) — 어느 노선으로 가는 경로든 지정 역으로 맞는다.
    expect(r).toEqual({ kind: "found", station: { label: "신도림역", lat: SINDORIM_2.lat, lng: SINDORIM_2.lng } });
  });

  it("이름이 같은 역이 2km 넘게 떨어져 있고 노선이 없으면 고르지 않고 노선 목록을 돌려준다", () => {
    expect(pickJourneyStation("양평역", undefined, [YANGPYEONG_5, YANGPYEONG_GJ], GILDONG)).toEqual({
      kind: "ambiguous",
      lines: ["5호선", "경의중앙선"],
    });
  });

  it("말한 노선의 역이 없으면 다른 노선의 역으로 대체하지 않는다", () => {
    expect(pickJourneyStation("신도림역", "7호선", [SINDORIM_1, SINDORIM_2], GILDONG)).toEqual({ kind: "ambiguous", lines: ["1호선", "2호선"] });
  });
});

describe("pickJourneyStop — 정류장 3-state(D3)", () => {
  const hit = { name: "길동사거리", lat: 37.538, lng: 127.14, source: "seoul" as const };
  it("첫 결과", () => {
    expect(pickJourneyStop({ stops: [hit, { ...hit, name: "둘째" }] })).toEqual({
      kind: "found",
      station: { label: "길동사거리", lat: 37.538, lng: 127.14, kind: "stop" },
    });
  });
  it("0건·실패·미검색을 가른다", () => {
    expect(pickJourneyStop({ stops: [] })).toEqual({ kind: "notFound" });
    expect(pickJourneyStop({ stops: [], failed: true })).toEqual({ kind: "failed" });
    expect(pickJourneyStop({ stops: [], unsearched: true })).toEqual({ kind: "unsearched" });
  });
});

describe("plan_journey 실행 — 게이트와 입력", () => {
  it("ctx.journey가 없으면 거절한다(능력 신고 없는 요청, 이중 방어)", async () => {
    const r = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "신도림역" }, { locale: "ko", dataLocale: "ko", userLocation: GILDONG });
    expect(r.data).toHaveProperty("error");
    expect(r.render).toBeUndefined();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("위치가 없으면 NO_LOCATION, 조회 0", async () => {
    const r = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "신도림역" }, ctxWith({}, { userLocation: undefined }));
    expect(r.data).toEqual({ error: "현재 위치를 알 수 없습니다." });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("현재 위치가 한국 밖이면 outOfCoverage, 검색·조회 0", async () => {
    const r = await executeFunction("plan_journey", { destination: "여의도공원" }, ctxWith({}, { userLocation: { lat: 37.7749, lng: -122.4194 } }));
    expect(r.data).toMatchObject({ outOfCoverage: true });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("목적지를 못 찾으면 placeNotFound이고 이 턴의 자리를 돌려준다", async () => {
    const ctx = ctxWith();
    const r = await executeFunction("plan_journey", { destination: "없는곳", board_station: "신도림역" }, ctx);
    expect(r.data).toEqual({ error: "'없는곳' 위치를 찾지 못했습니다." });
    expect(ctx.journey!.turn).toEqual({ asked: false, queried: false });
  });
});

describe("plan_journey 실행 — 후보(D4)", () => {
  it("두 역 모두 없으면 조회하지 않고 후보를 돌려준다(카드 없음)", async () => {
    const ctx = ctxWith();
    const r = await executeFunction("plan_journey", { destination: "여의도공원", transfer_side: "board" }, ctx);
    expect(r.data).toEqual({
      needStation: true,
      destination: "여의도공원",
      candidates: [
        { name: "길동역", line: "5호선", side: "board" },
        { name: "천호(풍납토성)역", line: "8호선", side: "board" },
      ],
    });
    expect(r.render).toBeUndefined();
    expect(r.source).toEqual([{ label: "source.odsay" }]);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockTransit).toHaveBeenCalledWith({ origin: GILDONG, dest: { lat: DEST.lat, lng: DEST.lng }, includeStops: true });
    expect(ctx.journey!.turn.asked).toBe(true);
  });

  it("대중교통 경로가 없으면 candidates: []", async () => {
    mockTransit.mockResolvedValue(null);
    const r = await executeFunction("plan_journey", { destination: "여의도공원" }, ctxWith());
    expect(r.data).toEqual({ needStation: true, destination: "여의도공원", candidates: [] });
    expect(r.source).toBeUndefined();
  });

  it("대중교통 조회 실패는 throw(「후보 없음」으로 접지 않는다)이고 자리를 돌려준다", async () => {
    mockTransit.mockRejectedValue(new Error("ODsay 오류"));
    const ctx = ctxWith();
    await expect(executeFunction("plan_journey", { destination: "여의도공원" }, ctx)).rejects.toThrow("ODsay 오류");
    expect(ctx.journey!.turn.asked).toBe(false);
  });
});

describe("plan_journey 실행 — 여정 조회와 3-state", () => {
  it("역을 서버가 풀어 진입 함수 하나로 조회하고 요약과 카드를 돌려준다", async () => {
    const ctx = ctxWith();
    const r = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "신도림", board_line: "1호선" }, ctx);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]).toEqual([
      {
        from: GILDONG,
        to: { lat: DEST.lat, lng: DEST.lng },
        board: { name: "신도림역 1호선", coord: { lat: 37.5088, lng: 126.8912 }, line: "수도권1호선" },
        stops: true,
      },
      "1.2.3.4",
    ]);
    expect(r.render).toMatchObject({
      type: "journey",
      result: JOURNEY,
      origin: GILDONG,
      manualOrigin: false,
      board: { label: "신도림역 1호선", lat: 37.5088, lng: 126.8912, line: "수도권1호선" },
      alight: null,
      dest: { lat: DEST.lat, lng: DEST.lng },
      destLabel: "여의도공원",
      destRoman: null,
    });
    expect(typeof (r.render as { queriedAt: number }).queriedAt).toBe("number");
    expect(r.source).toEqual([{ label: "source.odsay" }, { label: "source.tmap" }, { label: "source.kakaomobility" }]);
    expect(ctx.journey!.turn).toEqual({ asked: false, queried: true });
  });

  it("data는 요약뿐이다 — 좌표·기하·안내 단계가 없다(D9)", async () => {
    const r = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "신도림역", board_line: "1호선" }, ctxWith());
    expect(r.data).toEqual({
      destination: "여의도공원",
      journey: {
        variants: [
          {
            shownOnCard: true,
            kind: "designated",
            boardStation: "신도림",
            alightStation: "여의도",
            totalMinutes: 42,
            taxiFare: 14000,
            transitFare: 1500,
            taxiInMinutes: 25,
            transit: [{ mode: "subway", line: "수도권 1호선", from: "신도림", to: "여의도", minutes: 5 }],
          },
        ],
      },
    });
    expect(JSON.stringify(r.data)).not.toMatch(/"lat"|"lng"|"coord"|"guides"/);
  });

  it("지정한 역으로 못 찾아 추천으로 바뀐 쪽을 요약에 싣는다(D11)", () => {
    expect(journeySummary({ ...JOURNEY, designatedMissing: { side: "board" } })).toMatchObject({ designatedMissing: "board" });
  });

  it("경로 없음은 journey: null(카드 없음)", async () => {
    mockQuery.mockResolvedValue({ kind: "ok", result: { variants: [] } });
    const r = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "신도림역", board_line: "1호선" }, ctxWith());
    expect(r.data).toEqual({ destination: "여의도공원", journey: null });
    expect(r.render).toBeUndefined();
  });

  it("조회 실패는 throw다(경로 없음과 다르다)", async () => {
    mockQuery.mockRejectedValue(new Error("Tmap 오류"));
    await expect(
      executeFunction("plan_journey", { destination: "여의도공원", board_station: "신도림역", board_line: "1호선" }, ctxWith()),
    ).rejects.toThrow("Tmap 오류");
  });

  it("한도 거절은 전용 마커로 돌린다(카드 없음)", async () => {
    mockQuery.mockResolvedValue({ kind: "rateLimited" });
    const limited = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "신도림역", board_line: "1호선" }, ctxWith());
    expect(limited.data).toMatchObject({ rateLimited: true });
    expect(limited.data).not.toHaveProperty("journey");
    expect(limited.render).toBeUndefined();

    mockQuery.mockResolvedValue({ kind: "budgetExhausted" });
    const spent = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "신도림역", board_line: "1호선" }, ctxWith());
    expect(spent.data).toMatchObject({ dailyBudgetExhausted: true });
    expect(spent.data).not.toHaveProperty("journey");
    expect(spent.render).toBeUndefined();
  });

  it("수동 위치면 카드에 manualOrigin: true", async () => {
    const r = await executeFunction(
      "plan_journey",
      { destination: "여의도공원", board_station: "신도림역", board_line: "1호선" },
      ctxWith({ manualOrigin: true }),
    );
    expect(r.render).toMatchObject({ type: "journey", manualOrigin: true });
  });
});

describe("plan_journey 실행 — 역 해석(D3)", () => {
  it("동명 역은 조회하지 않고 ambiguousStation을 돌려주며, 이 턴엔 더 조회하지 않는다", async () => {
    const ctx = ctxWith();
    const r = await executeFunction("plan_journey", { destination: "여의도공원", alight_station: "양평역" }, ctx);
    expect(r.data).toMatchObject({ ambiguousStation: { name: "양평역", side: "alight", lines: ["5호선", "경의중앙선"] } });
    expect(r.render).toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(ctx.journey!.turn.asked).toBe(true);

    const next = await executeFunction("plan_journey", { destination: "여의도공원", alight_station: "양평역", alight_line: "5호선" }, ctx);
    expect(next.data).toMatchObject({ askUserFirst: true });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("역을 못 찾으면 placeNotFound이고 자리를 돌려준다(다른 역으로 대체하지 않는다)", async () => {
    const ctx = ctxWith();
    const r = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "없는역" }, ctx);
    expect(r.data).toEqual({ error: "'없는역' 위치를 찾지 못했습니다." });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(ctx.journey!.turn).toEqual({ asked: false, queried: false });
  });

  it("정류장은 출발·목적 좌표를 기준으로 검색해 첫 결과를 kind: stop으로 넘긴다", async () => {
    mockStops.mockResolvedValue({ stops: [{ name: "길동사거리", lat: 37.538, lng: 127.14, source: "seoul" }] });
    const r = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "길동사거리", board_kind: "stop" }, ctxWith());
    expect(mockStops.mock.calls[0].slice(0, 2)).toEqual(["길동사거리", [GILDONG, { lat: DEST.lat, lng: DEST.lng }]]);
    expect(mockQuery.mock.calls[0][0].board).toEqual({ name: "길동사거리", coord: { lat: 37.538, lng: 127.14 }, kind: "stop" });
    expect(r.render).toMatchObject({ board: { label: "길동사거리", kind: "stop" } });
  });

  it("정류장 3-state: 0건은 placeNotFound, 실패·미검색은 서로 다른 마커이고 조회하지 않는다", async () => {
    const call = () => executeFunction("plan_journey", { destination: "여의도공원", board_station: "길동사거리", board_kind: "stop" }, ctxWith());

    mockStops.mockResolvedValue({ stops: [] });
    expect((await call()).data).toEqual({ error: "'길동사거리' 위치를 찾지 못했습니다." });

    mockStops.mockResolvedValue({ stops: [], failed: true });
    expect((await call()).data).toMatchObject({ stopSearchFailed: true, name: "길동사거리" });

    mockStops.mockRejectedValue(new Error("정류장 검색 전부 실패"));
    expect((await call()).data).toMatchObject({ stopSearchFailed: true });

    mockStops.mockResolvedValue({ stops: [], unsearched: true });
    expect((await call()).data).toMatchObject({ stopSearchUnavailable: true, name: "길동사거리" });

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("정류장 검색 키가 없으면 검색하지 않고 미제공 마커", async () => {
    vi.mocked(hasDataGoKrKey).mockReturnValue(false);
    const r = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "길동사거리", board_kind: "stop" }, ctxWith());
    expect(r.data).toMatchObject({ stopSearchUnavailable: true });
    expect(mockStops).not.toHaveBeenCalled();
  });
});

describe("plan_journey 실행 — 턴 규칙(D5)", () => {
  const QUERY = { destination: "여의도공원", board_station: "신도림역", board_line: "1호선" };

  it("한 턴에 여정 조회는 1회 — 두 번째는 turnLimit", async () => {
    const ctx = ctxWith();
    await executeFunction("plan_journey", QUERY, ctx);
    const second = await executeFunction("plan_journey", QUERY, ctx);
    expect(second.data).toMatchObject({ turnLimit: true });
    expect(second.render).toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("병렬로 두 번 불려도 조회는 1회(await 전에 자리를 잡는다)", async () => {
    const ctx = ctxWith();
    const [a, b] = await Promise.all([executeFunction("plan_journey", QUERY, ctx), executeFunction("plan_journey", QUERY, ctx)]);
    expect(a.render).toMatchObject({ type: "journey" });
    expect(b.data).toMatchObject({ turnLimit: true });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("후보를 돌려준 턴에는 여정을 조회하지 않는다 — askUserFirst", async () => {
    const ctx = ctxWith();
    await executeFunction("plan_journey", { destination: "여의도공원" }, ctx);
    const r = await executeFunction("plan_journey", { destination: "여의도공원", board_station: "길동역" }, ctx);
    expect(r.data).toMatchObject({ askUserFirst: true });
    expect(r.render).toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("후보 호출과 조회 호출이 병렬로 와도 조회하지 않는다(후보가 먼저)", async () => {
    const ctx = ctxWith();
    const [cand, query] = await Promise.all([
      executeFunction("plan_journey", { destination: "여의도공원" }, ctx),
      executeFunction("plan_journey", QUERY, ctx),
    ]);
    expect(cand.data).toMatchObject({ needStation: true });
    expect(query.data).toMatchObject({ askUserFirst: true });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("이미 조회한 턴에는 후보를 더 주지 않는다(카드와 되묻기가 섞이지 않는다)", async () => {
    const ctx = ctxWith();
    await executeFunction("plan_journey", QUERY, ctx);
    const r = await executeFunction("plan_journey", { destination: "여의도공원" }, ctx);
    expect(r.data).toMatchObject({ turnLimit: true });
    expect(mockTransit).not.toHaveBeenCalled();
  });

  it("조회가 실패(throw)해도 그 턴의 조회 자리는 쓴 것이다(유료 호출이 나갔을 수 있다)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("Tmap 오류"));
    const ctx = ctxWith();
    await expect(executeFunction("plan_journey", QUERY, ctx)).rejects.toThrow();
    expect((await executeFunction("plan_journey", QUERY, ctx)).data).toMatchObject({ turnLimit: true });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("턴이 바뀌면(새 컨텍스트) 다시 조회한다", async () => {
    await executeFunction("plan_journey", QUERY, ctxWith());
    await executeFunction("plan_journey", QUERY, ctxWith());
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
