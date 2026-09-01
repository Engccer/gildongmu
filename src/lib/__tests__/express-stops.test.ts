import { describe, expect, it } from "vitest";
import {
  EXPRESS_LINES,
  attachExpressStops,
  expressLineEntry,
  expressLineKey,
  expressLinesIn,
  extractExpressStops,
} from "../express-stops";
import type { TransitRoute } from "../types";

/**
 * 급행 정차역 집합 수락 판정(spec `2026-09-02-express-stops-data-design.md` §3.2).
 * fixture는 2026-09-02 실호출(개화 ↔ 중앙보훈병원, SearchPathType=1)의 축약본이다 — ID는 실제 ODsay 값.
 */

const LINE9 = EXPRESS_LINES.find((e) => e.line === "수도권 9호선")!;

const EXPRESS_16: Array<[number, string]> = [
  [902, "김포공항"], [905, "마곡나루"], [907, "가양"], [910, "염창"], [913, "당산"], [915, "여의도"],
  [917, "노량진"], [920, "동작"], [923, "고속터미널"], [925, "신논현"], [927, "선정릉"], [929, "봉은사"],
  [930, "종합운동장"], [933, "석촌"], [936, "올림픽공원"], [938, "중앙보훈병원"],
];
const NAMES_16 = EXPRESS_16.map(([, n]) => n);
// 완행 전량(38역)의 축약본 — 급행 16역 + 완행 전용 역 몇 개(진부분집합 검사가 성립하는 최소 형태)
const LOCAL_SUPERSET: Array<[number, string]> = [
  [901, "개화"], [902, "김포공항"], [903, "공항시장"], [904, "신방화"], [905, "마곡나루"], [906, "양천향교"],
  [907, "가양"], [908, "증미"], [910, "염창"], [913, "당산"], [915, "여의도"], [916, "샛강"], [917, "노량진"],
  [918, "노들"], [920, "동작"], [923, "고속터미널"], [925, "신논현"], [927, "선정릉"], [929, "봉은사"],
  [930, "종합운동장"], [933, "석촌"], [936, "올림픽공원"], [938, "중앙보훈병원"],
];

const stations = (rows: Array<[number | string, string]>) => ({
  stations: rows.map(([stationID, stationName]) => ({ stationID, stationName, x: "127.0", y: "37.5" })),
});
const subway = (lane: string, start: string, end: string, rows: Array<[number | string, string]>) => ({
  trafficType: 1,
  startName: start,
  endName: end,
  lane: [{ name: lane }],
  passStopList: stations(rows),
});
const walk = { trafficType: 3, distance: 0, sectionTime: 1 };
const path = (...subPath: unknown[]) => ({ pathType: 1, info: { totalTime: 70, payment: 1800 }, subPath });
const wrap = (...paths: unknown[]) => ({ result: { path: paths } }) as never;
const reversed = <T,>(rows: T[]) => [...rows].reverse();

/** 실호출 그대로의 정방향 응답: p0 = 완행 개화→김포공항 + 급행 전 구간, p1 = 완행 전 구간 */
const FORWARD = wrap(
  path(subway("수도권 9호선", "개화", "김포공항", [[901, "개화"], [902, "김포공항"]]), walk, subway(LINE9.expressLane, "김포공항", "중앙보훈병원", EXPRESS_16)),
  path(subway("수도권 9호선", "개화", "중앙보훈병원", LOCAL_SUPERSET)),
);
/** 역방향(중앙보훈병원→개화): 급행 전 구간 역순 + 완행 김포공항→개화 */
const REVERSE = wrap(
  path(subway(LINE9.expressLane, "중앙보훈병원", "김포공항", reversed(EXPRESS_16)), walk, subway("수도권 9호선", "김포공항", "개화", [[902, "김포공항"], [901, "개화"]])),
);
const fwdOnly = (rows: Array<[number | string, string]>, lane = LINE9.expressLane, start = "김포공항", end = "중앙보훈병원") =>
  wrap(path(subway(lane, start, end, rows)));

describe("expressLineKey — 끝에 붙은 (급행) 한 토큰만 벗긴다", () => {
  it("급행·완행 표기가 같은 키로 모인다", () => {
    expect(expressLineKey("수도권 9호선(급행)")).toBe("수도권 9호선");
    expect(expressLineKey("수도권 9호선")).toBe("수도권 9호선");
  });
  it("괄호 일반은 벗기지 않고 앵커가 아닌 자리도 벗기지 않는다", () => {
    expect(expressLineKey("수도권 공항철도(직통)")).toBe("수도권 공항철도(직통)");
    expect(expressLineKey("수도권 (급행)9호선")).toBe("수도권 (급행)9호선");
  });
  it("표 조회는 키로 한다 — 급행 leg도 완행 leg도 같은 항목", () => {
    expect(expressLineEntry("수도권 9호선(급행)")).toBe(LINE9);
    expect(expressLineEntry("수도권 9호선")).toBe(LINE9);
    expect(expressLineEntry("수도권 5호선")).toBeNull();
    expect(expressLineEntry(undefined)).toBeNull();
  });
});

describe("extractExpressStops — 수락 판정", () => {
  it("실호출 형태의 정·역방향 응답에서 16역을 순서대로 돌려준다", () => {
    expect(extractExpressStops(FORWARD, REVERSE, LINE9)).toEqual(NAMES_16);
  });

  it("①어느 방향이든 전 구간을 덮는 급행 leg가 없으면 부재(부분 구간 집합을 쓰지 않는다)", () => {
    expect(extractExpressStops(fwdOnly(EXPRESS_16.slice(0, 13), LINE9.expressLane, "김포공항", "종합운동장"), REVERSE, LINE9)).toBeNull();
    // 급행 lane 표기가 바뀌어도 같은 결과(표기 드리프트 = 부재)
    expect(extractExpressStops(fwdOnly(EXPRESS_16, "수도권 9호선 급행"), REVERSE, LINE9)).toBeNull();
    expect(extractExpressStops(wrap(), REVERSE, LINE9)).toBeNull();
    expect(extractExpressStops({} as never, REVERSE, LINE9)).toBeNull();
    // 역방향만 비어도 부재
    expect(extractExpressStops(FORWARD, wrap(), LINE9)).toBeNull();
  });

  it("②목록 양 끝이 span과 다르거나 이름이 비면 부재", () => {
    expect(extractExpressStops(fwdOnly([[901, "개화"], ...EXPRESS_16]), REVERSE, LINE9)).toBeNull();
    expect(extractExpressStops(fwdOnly(EXPRESS_16.slice(0, -1)), REVERSE, LINE9)).toBeNull();
    const blank: Array<[number, string]> = EXPRESS_16.map(([id, n], i) => [id, i === 5 ? " " : n]);
    expect(extractExpressStops(fwdOnly(blank), REVERSE, LINE9)).toBeNull();
  });

  it("③길이 3 미만·ID 부재·ID 중복·정규화 후 이름 중복은 부재", () => {
    expect(extractExpressStops(fwdOnly([[902, "김포공항"], [938, "중앙보훈병원"]]), REVERSE, LINE9)).toBeNull();
    const noId: Array<[number | string, string]> = EXPRESS_16.map(([id, n], i) => [i === 3 ? "" : id, n]);
    expect(extractExpressStops(fwdOnly(noId), REVERSE, LINE9)).toBeNull();
    const dupId: Array<[number, string]> = EXPRESS_16.map(([id, n], i) => [i === 3 ? 905 : id, n]);
    expect(extractExpressStops(fwdOnly(dupId), REVERSE, LINE9)).toBeNull();
    // "당산"과 "당산역"은 소비자 정규화에서 한 역 — 원문만 유일한 목록은 부재
    const dupName: Array<[number, string]> = EXPRESS_16.map(([id, n], i) => [id, i === 3 ? "당산역" : n]);
    expect(extractExpressStops(fwdOnly(dupName), REVERSE, LINE9)).toBeNull();
  });

  it("④같은 방향에 전 구간 급행 leg가 둘인데 목록이 다르면 부재", () => {
    const disagree = wrap(
      path(subway(LINE9.expressLane, "김포공항", "중앙보훈병원", EXPRESS_16)),
      path(subway(LINE9.expressLane, "김포공항", "중앙보훈병원", EXPRESS_16.filter(([, n]) => n !== "당산"))),
    );
    expect(extractExpressStops(disagree, REVERSE, LINE9)).toBeNull();
    const agree = wrap(
      path(subway(LINE9.expressLane, "김포공항", "중앙보훈병원", EXPRESS_16)),
      path(subway(LINE9.expressLane, "김포공항", "중앙보훈병원", EXPRESS_16)),
    );
    expect(extractExpressStops(agree, REVERSE, LINE9)).toEqual(NAMES_16);
  });

  it("⑤역방향이 정방향의 정확한 역순이 아니면 부재(방향별 패턴 상이·한 방향만 다른 모델링)", () => {
    const revMissing = fwdOnly(reversed(EXPRESS_16.filter(([, n]) => n !== "당산")), LINE9.expressLane, "중앙보훈병원", "김포공항");
    expect(extractExpressStops(FORWARD, revMissing, LINE9)).toBeNull();
    // 이름은 같은데 ID가 다른 역이 끼어도 부재
    const revIdDrift = fwdOnly(reversed(EXPRESS_16.map(([id, n]) => [n === "당산" ? 914 : id, n] as [number, string])), LINE9.expressLane, "중앙보훈병원", "김포공항");
    expect(extractExpressStops(FORWARD, revIdDrift, LINE9)).toBeNull();
  });

  it("⑥stationID가 강단조가 아니면 부재(다른 노선·순서 섞임)", () => {
    const shuffled: Array<[number, string]> = EXPRESS_16.map(([id, n], i) => [i === 3 ? 950 : id, n]);
    expect(extractExpressStops(fwdOnly(shuffled), fwdOnly(reversed(shuffled), LINE9.expressLane, "중앙보훈병원", "김포공항"), LINE9)).toBeNull();
    const nonNumeric: Array<[number | string, string]> = EXPRESS_16.map(([id, n], i) => [i === 3 ? "S910" : id, n]);
    expect(extractExpressStops(fwdOnly(nonNumeric), REVERSE, LINE9)).toBeNull();
  });

  it("⑦같은 span을 덮는 완행 leg가 있으면 급행은 그 진부분집합이어야 한다", () => {
    // 급행 목록에 완행에 없는 ID가 섞임 → 부재
    const alienRows: Array<[number, string]> = EXPRESS_16.map(([id, n], i) => (i === 3 ? [911, "가양대교"] : [id, n]));
    const alien = wrap(
      path(subway(LINE9.expressLane, "김포공항", "중앙보훈병원", alienRows)),
      path(subway("수도권 9호선", "김포공항", "중앙보훈병원", LOCAL_SUPERSET.slice(1))),
    );
    expect(extractExpressStops(alien, REVERSE, LINE9)).toBeNull();
    // 완행이 급행과 같은 목록(축약 소실) → 부재
    const same = wrap(
      path(subway(LINE9.expressLane, "김포공항", "중앙보훈병원", EXPRESS_16)),
      path(subway("수도권 9호선", "김포공항", "중앙보훈병원", EXPRESS_16)),
    );
    expect(extractExpressStops(same, REVERSE, LINE9)).toBeNull();
    // 완행 leg가 span을 덮지 않으면(개화→김포공항) 검사 대상이 아니다 → 통과
    expect(extractExpressStops(FORWARD, REVERSE, LINE9)).toEqual(NAMES_16);
  });
});

describe("attachExpressStops — 표 노선 지하철 leg 전부에 같은 집합", () => {
  const route = (...legs: TransitRoute["legs"]): TransitRoute => ({
    summary: { totalMinutes: 1, fare: 0, transfers: 0, walkMinutes: 0 },
    legs,
    routeKey: "p0",
  });
  const sets = new Map([["수도권 9호선", NAMES_16]]);

  it("완행 leg·급행 leg 둘 다 받고, 다른 노선·버스·도보는 무부착", () => {
    const [r] = attachExpressStops(
      [
        route(
          { mode: "walk", minutes: 1 },
          { mode: "subway", lineName: "수도권 9호선", minutes: 10 },
          { mode: "subway", lineName: "수도권 9호선(급행)", minutes: 10 },
          { mode: "subway", lineName: "수도권 5호선", minutes: 10 },
          { mode: "bus", lineName: "9", minutes: 10 },
        ),
      ],
      sets,
    );
    expect(r.legs.map((l) => l.expressStops)).toEqual([undefined, NAMES_16, NAMES_16, undefined, undefined]);
  });

  it("집합이 없는 노선은 키 자체가 없다(빈 배열 금지)", () => {
    const [r] = attachExpressStops([route({ mode: "subway", lineName: "수도권 9호선", minutes: 1 })], new Map());
    expect("expressStops" in r.legs[0]).toBe(false);
    const [r2] = attachExpressStops([route({ mode: "subway", lineName: "수도권 9호선", minutes: 1 })], new Map([["수도권 9호선", []]]));
    expect("expressStops" in r2.legs[0]).toBe(false);
  });

  it("expressLinesIn은 표 노선을 dedupe해 모은다", () => {
    const entries = expressLinesIn([
      route({ mode: "subway", lineName: "수도권 9호선", minutes: 1 }, { mode: "subway", lineName: "수도권 5호선", minutes: 1 }),
      route({ mode: "subway", lineName: "수도권 9호선(급행)", minutes: 1 }),
    ]);
    expect(entries).toEqual([LINE9]);
  });
});
