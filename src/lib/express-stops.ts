import { normalizeStationName } from "./station-match";
import type { Coord, TransitRoute } from "./types";

/**
 * 급행 정차역 집합(A16 L1 데이터층) — 순수 판정.
 *
 * `/api/route/transit` 지하철 leg의 `expressStops`는 소비자(실시간 안내)가 "이 급행은 {하차역}에
 * 서지 않습니다"라는 **결정적 문장과 활성화 차단**의 근거로 쓴다. 집합에 정차역이 빠지면 타도 되는
 * 열차를 막고, 없는 역이 들어가면 안 서는 열차를 허용한다 — 어느 방향도 화면·노선도를 못 보는
 * 사용자에게 반증 채널이 없다. 그래서 원칙은 **거짓 집합보다 부재**다: 아래 수락 판정 하나라도
 * 어긋나면 null이고, 부재의 뜻은 "판정 불가"이지 "급행 없음"이 아니다(빈 배열을 싣지 않는다 —
 * 빈 배열은 "어느 역에도 안 선다"로 읽혀 전 열차 차단이 된다).
 *
 * 데이터원은 ODsay `searchPubTransPathT` 노선 전 구간 조회 1회다(급행 leg의 `passStopList`가
 * 급행 정차역만 담는다 — 실호출 2026-08-23·2026-09-02). 조회·캐시는 `providers/odsay-express-stops.ts`.
 * 설계 정본 docs/superpowers/specs/2026-09-02-express-stops-data-design.md.
 */

export interface ExpressLineEntry {
  /** ODsay 완행 lane 표기 = 조인 키(`expressLineKey`가 급행 표기를 여기로 접는다) */
  line: string;
  /** 급행 leg를 고르는 lane 표기(완전 일치 — 표기가 바뀌면 부재로 떨어진다, 넓게 매칭하지 않는다) */
  expressLane: string;
  /** 노선 전 구간을 한 path의 한 급행 subPath로 돌려주는 OD(SearchPathType=1) */
  probe: { origin: Coord; dest: Coord };
  /** 급행 운행 구간 양 끝 — 전 구간 커버의 증명 기준 */
  span: { first: string; last: string };
}

/**
 * 표에 오르는 조건(전부 실호출로 증명, spec §3.1): ①ODsay가 그 노선 급행을 `(급행)` lane으로 모델한다
 * ②급행 정차 패턴이 노선당 하나이고 양방향 동일이다 ③전 구간을 한 급행 subPath로 주는 OD가 있다.
 * 1호선은 ODsay가 급행 lane을 주지 않고(용산→동인천 완행뿐, 2026-09-02) 패턴도 여럿이라 ①②가 깨지고,
 * 공항철도 직통은 정차역 2곳 + 실시간 축 부재라 소비자 판정이 성립하지 않는다 → 표에 없다(부재).
 */
export const EXPRESS_LINES: readonly ExpressLineEntry[] = [
  {
    line: "수도권 9호선",
    expressLane: "수도권 9호선(급행)",
    // 개화 → 중앙보훈병원(실호출 2026-09-02: 급행 leg 김포공항→중앙보훈병원 16역)
    probe: { origin: { lat: 37.5786, lng: 126.7969 }, dest: { lat: 37.5205, lng: 127.1508 } },
    span: { first: "김포공항", last: "중앙보훈병원" },
  },
];

/**
 * 끝에 붙은 `(급행)` 한 토큰만 벗긴다(`transit-guide.ts` `subwayLineCore`와 같은 앵커 원칙 —
 * 괄호 일반을 벗기면 `(직통)`류 다른 등급까지 접힌다). `수도권` 접두는 남긴다(표 키가 완행 원문).
 */
export function expressLineKey(name: string): string {
  return name.replace(/\(급행\)\s*$/, "").trim();
}

export function expressLineEntry(lineName: string | undefined): ExpressLineEntry | null {
  if (!lineName) return null;
  const key = expressLineKey(lineName);
  return EXPRESS_LINES.find((e) => e.line === key) ?? null;
}

/** 수락 판정이 읽는 최소 응답 모양(provider `OdsayResponse`의 부분집합 — 필드 추가에 무관하게 동작). */
interface StopLike {
  stationID?: number | string;
  stationName?: string;
}
interface SubPathLike {
  trafficType?: number;
  startName?: string;
  endName?: string;
  lane?: Array<{ name?: string }>;
  passStopList?: { stations?: StopLike[] };
}
export interface ExpressResponseLike {
  result?: { path?: Array<{ subPath?: SubPathLike[] }> };
}

interface StopRow {
  id: string;
  name: string;
}

function stopRows(sp: SubPathLike): StopRow[] {
  const stations = sp.passStopList?.stations;
  if (!Array.isArray(stations)) return [];
  return stations.map((s) => ({
    id: s?.stationID == null ? "" : String(s.stationID).trim(),
    name: String(s?.stationName ?? "").trim(),
  }));
}

function sameRows(a: StopRow[], b: StopRow[]): boolean {
  return a.length === b.length && a.every((r, i) => r.id === b[i].id && r.name === b[i].name);
}

function subwaySubPaths(data: ExpressResponseLike): SubPathLike[] {
  const paths = data?.result?.path;
  if (!Array.isArray(paths)) return [];
  return paths.flatMap((p) =>
    (Array.isArray(p?.subPath) ? p.subPath : []).filter((sp) => sp?.trafficType === 1),
  );
}

/**
 * 한 방향 응답에서 `from → to` 전 구간을 덮는 급행 leg의 (ID, 이름) 목록. 조건 ①~④·⑥(단조)·⑦(완행 부분집합)을
 * 여기서 보고, 방향 간 대칭(⑤)은 `extractExpressStops`가 본다. 어긋나면 null.
 */
function directionalRows(
  data: ExpressResponseLike,
  entry: ExpressLineEntry,
  from: string,
  to: string,
): StopRow[] | null {
  const subways = subwaySubPaths(data);
  const covers = (sp: SubPathLike) =>
    String(sp.startName ?? "").trim() === from && String(sp.endName ?? "").trim() === to;
  const candidates = subways
    .filter((sp) => sp.lane?.[0]?.name === entry.expressLane && covers(sp))
    .map(stopRows);
  if (candidates.length === 0) return null; // ①

  const rows = candidates[0];
  if (rows.length < 3) return null; // ③
  if (rows.some((r) => !r.name || !r.id)) return null; // ②·③ 빈 이름·ID 부재
  if (rows[0].name !== from || rows[rows.length - 1].name !== to) return null; // ②
  if (new Set(rows.map((r) => r.id)).size !== rows.length) return null; // ③ ID 중복
  if (new Set(rows.map((r) => normalizeStationName(r.name))).size !== rows.length) return null; // ③ 이름 중복(정규화 후)
  if (candidates.some((c) => !sameRows(c, rows))) return null; // ④

  // ⑥ stationID 강단조(한 방향 안에서 증가 또는 감소 중 하나). 숫자가 아닌 ID는 판정 불가 → 부재.
  const ids = rows.map((r) => Number(r.id));
  if (ids.some((n) => !Number.isFinite(n))) return null;
  const increasing = ids.every((n, i) => i === 0 || n > ids[i - 1]);
  const decreasing = ids.every((n, i) => i === 0 || n < ids[i - 1]);
  if (!increasing && !decreasing) return null;

  // ⑦ 같은 구간 완행 leg가 있으면 급행은 그 진부분집합(ID 기준). passStopList가 없는 완행 leg는
  //    비교 대상이 없는 것이지 반례가 아니라 건너뛴다(spec "없으면 건너뛴다").
  const locals = subways
    .filter((sp) => sp.lane?.[0]?.name === entry.line && covers(sp))
    .map(stopRows)
    .filter((local) => local.length > 0);
  for (const local of locals) {
    const localIds = new Set(local.map((r) => r.id));
    if (!rows.every((r) => localIds.has(r.id))) return null;
    if (rows.length >= local.length) return null;
  }
  return rows;
}

/**
 * 정·역방향 두 응답에서 급행 정차역 집합을 뽑는다(spec §3.2). 하나라도 어긋나면 null(부재):
 * ①어느 방향이든 전 구간(`span`)을 덮는 급행 leg 0건 ②목록 양 끝 ≠ span 또는 빈 이름 ③길이 < 3·ID 부재·
 * ID 중복·정규화 후 이름 중복 ④같은 방향 후보가 둘 이상인데 목록이 다르다 ⑤역방향이 정방향의 정확한 역순이
 * 아니다(ID·이름) ⑥ID가 강단조가 아니다 ⑦같은 span 완행 leg가 있으면 급행은 그 진부분집합(없으면 건너뛴다).
 *
 * ⚠ ODsay 데이터가 양방향 일관되게 틀린 경우(여의도 대신 샛강)는 단일 소스 안에서 못 잡는다 —
 *   그 축은 실호출 게이트의 16역 골든(`scripts/verify-odsay-express-stops.mjs`)이 맡는다.
 */
export interface ExpressStopSet {
  /** ODsay `passStopList` 원문 역명(노선 순서) */
  names: string[];
  /** 같은 순서의 ODsay `stationID` 원문 — 소비자는 ID가 있으면 정규화 없이 ID로 판정한다 */
  ids: string[];
}

export function extractExpressStops(
  forward: ExpressResponseLike,
  reverse: ExpressResponseLike,
  entry: ExpressLineEntry,
): ExpressStopSet | null {
  const fwd = directionalRows(forward, entry, entry.span.first, entry.span.last);
  if (!fwd) return null;
  const rev = directionalRows(reverse, entry, entry.span.last, entry.span.first);
  if (!rev) return null;
  if (!sameRows([...rev].reverse(), fwd)) return null; // ⑤
  return { names: fwd.map((r) => r.name), ids: fwd.map((r) => r.id) };
}

/**
 * 표 노선의 지하철 leg 전부(완행·급행)에 같은 집합을 붙인다(`expressStops` 이름 + `expressStopIds` ID, 같은 순서).
 * 집합이 없는 노선은 키 자체가 없다 — 빈 배열·길이 불일치 집합은 싣지 않는다(마지막 게이트).
 * 소비자 시나리오가 "완행 leg × 급행 잠금 후보"라 완행 leg에 없으면 이 필드는 존재 이유가 없다.
 */
export function attachExpressStops(
  routes: TransitRoute[],
  sets: Map<string, ExpressStopSet>,
): TransitRoute[] {
  if (sets.size === 0) return routes;
  return routes.map((route) => ({
    ...route,
    legs: route.legs.map((leg) => {
      if (leg.mode !== "subway" || !leg.lineName) return leg;
      const set = sets.get(expressLineKey(leg.lineName));
      if (!set || set.names.length === 0 || set.ids.length !== set.names.length) return leg;
      return { ...leg, expressStops: set.names, expressStopIds: set.ids };
    }),
  }));
}

/** 표 노선 중 이 경로들에 등장하는 것(조회 dedupe용). */
export function expressLinesIn(routes: TransitRoute[]): ExpressLineEntry[] {
  const seen = new Map<string, ExpressLineEntry>();
  for (const route of routes) {
    for (const leg of route.legs) {
      if (leg.mode !== "subway") continue;
      const entry = expressLineEntry(leg.lineName);
      if (entry) seen.set(entry.line, entry);
    }
  }
  return [...seen.values()];
}
