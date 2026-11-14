/**
 * 노선 번호로 버스 노선을 찾아 답할 재료를 만든다(E87, 채팅 도구 `get_bus_route`). React/Next 비의존.
 * 설계: `docs/superpowers/specs/2026-11-14-e87-chat-bus-route-tool-design.md`.
 *
 * 두 층이다. `lookupBusRoute`는 서울(TOPIS)과 사용자 지역(TAGO)에서 번호가 같은 노선을 모아 하나를 고르고,
 * `describeBusRoute`는 고른 노선에서 질문과 관련된 부분만 뽑는다(순수, 좌표를 내보내지 않는다).
 * 외부 호출은 전부 deps라 순수하게 테스트한다(`journey/stop-search.ts`와 같은 꼴).
 */
import { haversineMeters } from "./geo";
import { busStopKey } from "./journey/station-identity";
import { stopSearchDeps } from "./journey/stop-search";
import { fetchSeoulLineStops, searchSeoulRoutesByNo } from "./providers/seoul-bus";
import { fetchTagoLineStops, fetchTagoRouteInterval, searchTagoRoutesByNo } from "./providers/tago-bus";
import { romanNameOf } from "./romanize";
import { judgeTagoCityCoverage, tagoCityCodeOf } from "./tago-coverage";
import type { BusLine, BusLineStop, BusSource, Coord } from "./types";

/** 노선이 「내 근처를 지난다」고 볼 거리(m): 같은 번호가 여러 지역에 있을 때 고르는 기준. */
export const BUS_ROUTE_NEAR_M = 1_000;
/** 타는 정류소로 볼 거리(m): 서울 근접 정류소 조회 반경과 같다. */
export const BUS_ROUTE_BOARD_M = 500;
/** 경유 정류소를 받아 볼 후보 수 상한. 넘으면 정류소 없이 후보만 돌려준다. */
const MAX_CANDIDATES = 6;
/** 되물을 후보·비슷한 번호·이름이 걸린 정류소를 돌려주는 수. */
const MAX_LISTED = 5;
const NEXT_STOPS = 5;
const SAMPLE_STOPS = 8;

/** 「272번」「n62 번 버스」→「272」「N62」. */
export function normalizeRouteNo(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\s+/g, "")
    .replace(/(번버스|번|버스)$/, "")
    .toUpperCase();
}

/**
 * 제공처 노선 이름이 사용자가 말한 번호인가. 같거나, 번호 뒤에 한글 지역 꼬리만 붙은 것(TOPIS의 수도권 노선
 * 「30-3하남」)이다. 「1003(심야)」「2720」은 다른 노선이다.
 */
export function routeNoMatches(lineNo: string, query: string): boolean {
  const n = normalizeRouteNo(lineNo);
  if (query === "" || !n.startsWith(query)) return false;
  return /^[가-힣]*$/.test(n.slice(query.length));
}

export interface BusRouteDeps {
  /** 카카오 역지오코딩. null은 판정 불가다. */
  region: (coord: Coord) => Promise<{ province: string; city: string } | null>;
  /** 좌표 근접 TAGO 정류소의 도시코드(행정구역과 일대일이 아니다: 담양 좌표에 광주 24). */
  nearbyCityCodes: (coord: Coord) => Promise<string[]>;
  searchSeoul: (q: string) => Promise<BusLine[]>;
  searchTago: (cityCode: string, q: string) => Promise<BusLine[]>;
  seoulStops: (routeId: string) => Promise<BusLineStop[]>;
  tagoStops: (line: BusLine) => Promise<{ stops: BusLineStop[]; truncated: boolean }>;
  tagoInterval: (cityCode: string, routeId: string) => Promise<number | null>;
}

export const busRouteDeps: BusRouteDeps = {
  region: stopSearchDeps.region,
  nearbyCityCodes: stopSearchDeps.nearbyCityCodes,
  searchSeoul: searchSeoulRoutesByNo,
  searchTago: searchTagoRoutesByNo,
  seoulStops: fetchSeoulLineStops,
  tagoStops: fetchTagoLineStops,
  tagoInterval: fetchTagoRouteInterval,
};

/**
 * 사용자 지역(TAGO)을 어디까지 봤는가. 서울(TOPIS)은 늘 본다.
 * - `seoul`: 좌표가 서울이라 TOPIS가 곧 그 지역이다.
 * - `searched`: 그 지역 도시코드로 조회했다.
 * - `uncovered`: TAGO가 그 지역 노선을 갖고 있지 않다(없다는 뜻이 아니다).
 * - `unknown`: 지역을 가리지 못했다.
 * - `noLocation`: 기준 좌표가 없다.
 */
export type LocalSearch = "seoul" | "searched" | "uncovered" | "unknown" | "noLocation";

export interface BusRouteCandidate {
  line: BusLine;
  /** 지역 이름(서울은 「서울」, TAGO는 역지오코딩에서 온 시도·시군 이름). 모르면 없다. */
  region?: string;
  /** 경유 정류소. 조회에 실패했거나 받지 않았으면 null. */
  stops: BusLineStop[] | null;
  /** 받은 정류소가 전체보다 적다. */
  truncated: boolean;
  /** 기준 좌표에서 `BUS_ROUTE_NEAR_M` 안에 정류소가 있는가. 좌표나 정류소가 없으면 null. */
  nearYou: boolean | null;
}

export type BusRouteLookup =
  | { kind: "found"; chosen: BusRouteCandidate; local: LocalSearch; searchFailed: BusSource[] }
  | { kind: "ambiguous"; candidates: BusRouteCandidate[]; /** 후보가 더 있어 잘랐다. */ more?: true; local: LocalSearch; searchFailed: BusSource[] }
  | { kind: "notFound"; similar: string[]; local: LocalSearch };

export interface BusRouteQuery {
  /** `normalizeRouteNo`를 거친 번호. */
  routeNo: string;
  coord?: Coord;
  fromStop?: string;
  /** 좌표가 사용자가 말한 지명에서 왔다: 지역(도시코드)만 가리고 「근처를 지나는 노선」으로 고르지 않는다. */
  regionOnly?: boolean;
}

function minDistance(stops: BusLineStop[], coord: Coord): number {
  let min = Infinity;
  for (const s of stops) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    min = Math.min(min, haversineMeters(coord.lat, coord.lng, s.lat, s.lng));
  }
  return min;
}

/**
 * 번호가 같은 노선을 모아 하나를 고른다.
 *
 * 고르는 차례: 후보가 하나면 그것 → 기준 좌표 근처를 지나는 노선 → (근처에 없으면) 기준 위치 지역의 노선 →
 * (그래도 여럿이면) 타는 정류소 이름이 있는 노선 → 못 가르면 `ambiguous`(모델이 되묻는다). 가려는 정류소 이름으로는 고르지 않는다: 「이 버스 ○○ 가?」에 ○○에 서는
 * 다른 지역 노선을 골라 「간다」고 답하게 된다.
 *
 * 번호 검색이 하나라도 실패했는데 찾은 노선이 없으면 throw다(조회 실패 ≠ 없음).
 */
export async function lookupBusRoute(q: BusRouteQuery, deps: BusRouteDeps): Promise<BusRouteLookup> {
  // 1) 사용자 지역의 TAGO 도시코드.
  const targets = new Map<string, string | undefined>(); // 도시코드 → 지역 이름
  let local: LocalSearch = "noLocation";
  if (q.coord) {
    const coord = q.coord;
    const region = await deps.region(coord).catch(() => null);
    const fromTable = region ? tagoCityCodeOf(region.province, region.city) : null;
    if (fromTable === "seoul") {
      local = "seoul";
    } else {
      if (fromTable && region) {
        targets.set(fromTable, fromTable.length <= 2 ? region.province : region.city.split(" ")[0] || region.province);
      }
      const near = await deps.nearbyCityCodes(coord).catch(() => [] as string[]);
      for (const code of near) if (!targets.has(code)) targets.set(code, undefined);
      if (targets.size > 0) local = "searched";
      else if (region && judgeTagoCityCoverage(region.province, region.city) === "uncovered") local = "uncovered";
      else local = "unknown";
    }
  }

  // 2) 번호 검색(서울 + 지역).
  const searchFailed = new Set<BusSource>();
  const [seoulR, ...tagoR] = await Promise.allSettled([
    deps.searchSeoul(q.routeNo),
    ...[...targets.keys()].map((code) => deps.searchTago(code, q.routeNo)),
  ]);
  const all: BusLine[] = [];
  if (seoulR.status === "fulfilled") all.push(...seoulR.value);
  else searchFailed.add("seoul");
  for (const r of tagoR) {
    if (r.status === "fulfilled") all.push(...r.value);
    else searchFailed.add("tago");
  }
  // 같은 노선이 TOPIS와 TAGO 양쪽에 있으면(수도권 진입 노선 「1003남양주」와 남양주 「1003」) 앞선 것(서울) 하나로 합친다.
  // TOPIS는 서울 밖 노선의 첫차·막차를 비워 주므로 빈 칸만 TAGO 값으로 채운다.
  const byEnds = new Map<string, BusLine>();
  for (const l of all) {
    if (!routeNoMatches(l.routeNo, q.routeNo)) continue;
    const key = `${busStopKey(l.startStop)}|${busStopKey(l.endStop)}`;
    const prev = byEnds.get(key);
    if (!prev) byEnds.set(key, l);
    else
      byEnds.set(key, {
        ...prev,
        routeType: prev.routeType || l.routeType,
        firstMinutes: prev.firstMinutes ?? l.firstMinutes,
        lastMinutes: prev.lastMinutes ?? l.lastMinutes,
        intervalMinutes: prev.intervalMinutes ?? l.intervalMinutes,
      });
  }
  const exact = [...byEnds.values()];
  if (exact.length === 0) {
    if (searchFailed.size > 0) throw new Error(`버스 노선 조회 실패: ${[...searchFailed].join(", ")}`);
    const similar = [...new Set(all.map((l) => l.routeNo))].slice(0, MAX_LISTED);
    return { kind: "notFound", similar, local };
  }

  // 3) 경유 정류소(후보가 너무 많으면 받지 않고 되묻게 한다).
  const withStops = exact.length <= MAX_CANDIDATES;
  const candidates = await Promise.all(
    exact.map(async (line): Promise<BusRouteCandidate> => {
      // TOPIS의 서울 밖 노선은 이름 꼬리가 지역이다(「1003남양주」→ 남양주).
      const region =
        line.source === "seoul"
          ? normalizeRouteNo(line.routeNo).slice(q.routeNo.length) || "서울"
          : targets.get(line.cityCode ?? "");
      const base = { line, ...(region ? { region } : {}) };
      if (!withStops) return { ...base, stops: null, truncated: false, nearYou: null };
      try {
        const r =
          line.source === "seoul"
            ? { stops: await deps.seoulStops(line.routeId), truncated: false }
            : await deps.tagoStops(line);
        // 빈 목록은 「정류소 0개인 노선」이 아니라 받지 못한 것이다.
        if (r.stops.length === 0) return { ...base, stops: null, truncated: false, nearYou: null };
        // 지명으로 푼 좌표는 지역만 가린다: 그 한 점 근처를 지나는지로 노선을 고르지 않는다(spec §2).
        const nearYou = q.coord && !q.regionOnly ? minDistance(r.stops, q.coord) <= BUS_ROUTE_NEAR_M : null;
        return { ...base, stops: r.stops, truncated: r.truncated, nearYou };
      } catch (e) {
        console.error("[bus-route] 경유 정류소 조회 실패", e);
        return { ...base, stops: null, truncated: false, nearYou: null };
      }
    }),
  );

  // 4) 고르기.
  const failed = [...searchFailed];
  const pick = async (chosen: BusRouteCandidate): Promise<BusRouteLookup> => {
    const { line } = chosen;
    if (line.source === "tago" && line.cityCode && line.intervalMinutes == null) {
      const intervalMinutes = await deps.tagoInterval(line.cityCode, line.routeId).catch(() => null);
      return { kind: "found", chosen: { ...chosen, line: { ...line, intervalMinutes } }, local, searchFailed: failed };
    }
    return { kind: "found", chosen, local, searchFailed: failed };
  };
  if (candidates.length === 1) return pick(candidates[0]);
  const near = candidates.filter((c) => c.nearYou === true);
  let pool = near.length > 0 ? near : candidates;
  if (pool.length === 1) return pick(pool[0]);
  if (near.length === 0) {
    // 근처를 지나는 노선이 없으면 기준 위치 지역(TAGO 도시코드)의 노선이 먼저다: 부산에서 물은 1003번은 부산 1003번이다.
    const localLines = candidates.filter((c) => c.line.source === "tago");
    if (localLines.length === 1) return pick(localLines[0]);
    if (localLines.length > 1) pool = localLines;
  }
  if (q.fromStop) {
    const from = q.fromStop;
    const byStop = pool.filter((c) => c.stops && matchLineStops(c.stops, from).length > 0);
    if (byStop.length === 1) return pick(byStop[0]);
  }
  return {
    kind: "ambiguous",
    candidates: pool.slice(0, MAX_LISTED),
    ...(pool.length > MAX_LISTED ? { more: true as const } : {}),
    local,
    searchFailed: failed,
  };
}

function compact(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, "");
}

/**
 * 이름이 걸리는 정류소의 순번(배열 인덱스). 정확한 것이 있으면 그것만 쓴다: 이름 전체, 대표 이름(`busStopKey`),
 * 「.」로 나뉜 조각 중 하나가 같은 것. 없으면 이름에 질의가 들어 있는 것이다. 질의가 한 글자면 찾지 않는다.
 */
export function matchLineStops(stops: readonly BusLineStop[], query: string): number[] {
  const q = compact(query).replace(/(정류장|정류소)$/, "");
  if (q.length < 2) return [];
  const names = stops.map((s) => compact(s.name));
  const exact: number[] = [];
  const partial: number[] = [];
  names.forEach((n, i) => {
    if (n === q || busStopKey(n) === q || n.split(".").includes(q)) exact.push(i);
    else if (n.includes(q)) partial.push(i);
  });
  return exact.length > 0 ? exact : partial;
}

function hhmm(minutes: number | null): string | null {
  if (minutes == null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export interface BusRouteAsk {
  /** 기준 좌표(현재 위치·보고 있는 장소·지명). 없으면 타는 정류소를 짐작하지 않는다. */
  coord?: Coord;
  /** 타는 정류소 이름. */
  fromStop?: string;
  /** 가려는 정류소 이름. */
  toStop?: string;
  /** 영어 데이터 로케일이면 이름을 「로마자 (한글)」로 낸다(E28: 괄호 한글이 끝). */
  roman: boolean;
}

/** 후보 한 줄: 되물을 때와 고른 노선의 머리에 함께 쓴다. */
export function summarizeBusLine(c: BusRouteCandidate, roman: boolean): Record<string, unknown> {
  const nm = namer(roman);
  const { line } = c;
  return {
    // 지역 꼬리가 붙은 이름(「1003남양주」)은 번호만 남긴다(꼬리는 `region`이 말한다).
    routeNo: c.region && line.routeNo.endsWith(c.region) ? line.routeNo.slice(0, -c.region.length) : line.routeNo,
    ...(c.region ? { region: c.region } : {}),
    ...(line.routeType ? { routeType: line.routeType } : {}),
    startStop: nm(line.startStop),
    endStop: nm(line.endStop),
    ...(c.nearYou != null ? { passesNearYou: c.nearYou } : {}),
  };
}

function namer(roman: boolean): (name: string) => string {
  return (name) => {
    if (!roman) return name;
    const r = romanNameOf(name);
    return r ? `${r} (${name})` : name;
  };
}

/**
 * 고른 노선에서 질문과 관련된 부분만 뽑는다(좌표 없음, 경유 정류소 전부 나열 없음).
 *
 * - `boarding`: 타는 곳. 이름을 받았으면 그 정류소, 아니면 기준 좌표에서 `BUS_ROUTE_BOARD_M` 안의 방면별 가장 가까운 정류소.
 * - `rides`: 타는 곳에서 그 방면 차로 가려는 정류소까지 몇 정류장인가. 회차 지점을 지나야 닿는 줄은 다른 줄이 없을 때만 남긴다.
 * - `nextStops`: 가려는 곳을 묻지 않았을 때 타는 곳 다음 정류소 몇 개. `someStops`: 타는 곳도 모르거나 가려는 정류소가 노선에 없을 때
 *   기점에서 회차 지점까지 고르게 뽑은 몇 개.
 */
export function describeBusRoute(c: BusRouteCandidate, ask: BusRouteAsk): Record<string, unknown> {
  const nm = namer(ask.roman);
  const { line, stops } = c;
  const turnaroundIdx = stops ? stops.findIndex((s) => s.turnaround) : -1;
  const route = {
    ...summarizeBusLine(c, ask.roman),
    ...(stops && turnaroundIdx >= 0 ? { turnaroundStop: nm(stops[turnaroundIdx].name) } : {}),
    firstBus: hhmm(line.firstMinutes),
    lastBus: hhmm(line.lastMinutes),
    intervalMinutes: line.intervalMinutes,
    ...(stops ? { stopCount: stops.length } : {}),
  };
  if (!stops) return { route, stops: "unavailable" };

  const out: Record<string, unknown> = {};
  if (c.truncated) out.stopsIncomplete = true;
  // 가려는 정류소를 물었으면 그 답(rides·toStop)을 노선 머리보다 앞에 둔다: 머리가 앞이면 모델이 「간다」만 말하고
  // 몇 정류장 뒤인지를 빼는 일이 잦았다(실호출 2026-11-14, 6회 중 4회).
  const finish = (): Record<string, unknown> => {
    const { rides, toStop, ...rest } = out;
    return toStop === undefined ? { route, ...rest } : { ...(rides === undefined ? {} : { rides }), toStop, ...rest, route };
  };

  // 타는 곳.
  interface Ref {
    idx: number;
    distanceMeters?: number;
  }
  let refs: Ref[] = [];
  if (ask.fromStop) {
    refs = matchLineStops(stops, ask.fromStop).map((idx) => ({ idx }));
    if (refs.length === 0) out.fromStop = { query: ask.fromStop, onRoute: false };
  } else if (ask.coord) {
    const nearest = new Map<string, Ref & { distanceMeters: number }>();
    stops.forEach((s, idx) => {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
      const d = haversineMeters(ask.coord!.lat, ask.coord!.lng, s.lat, s.lng);
      if (d > BUS_ROUTE_BOARD_M) return;
      const prev = nearest.get(s.towards);
      if (!prev || d < prev.distanceMeters) nearest.set(s.towards, { idx, distanceMeters: Math.round(d) });
    });
    refs = [...nearest.values()].sort((a, b) => a.idx - b.idx);
  }
  refs = refs.slice(0, MAX_LISTED);
  if (refs.length > 0) {
    out.boarding = refs.map((r) => ({
      stop: nm(stops[r.idx].name),
      ...(stops[r.idx].towards ? { towards: nm(stops[r.idx].towards) } : {}),
      ...(r.distanceMeters != null ? { distanceMeters: r.distanceMeters } : {}),
    }));
  }

  if (ask.toStop) {
    const targets = matchLineStops(stops, ask.toStop);
    if (targets.length === 0) {
      // 서지 않는다는 답에는 대신 어디를 지나는지가 따라온다: 일부를 함께 싣는다(없으면 모델이 웹 검색으로 채운다, 실호출 2026-11-14).
      out.toStop = { query: ask.toStop, onRoute: false };
      const some = someStops(stops, turnaroundIdx, nm);
      if (some) out.someStops = some;
      return finish();
    }
    const seen = new Set<string>();
    const served = targets
      .map((i) => ({ name: nm(stops[i].name), ...(stops[i].towards ? { towards: nm(stops[i].towards) } : {}) }))
      .filter((s) => {
        const key = `${s.name}|${s.towards ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_LISTED);
    out.toStop = { query: ask.toStop, onRoute: true, stops: served };
    if (refs.length > 0) {
      const rides = refs.flatMap((r) => {
        const t = targets.find((i) => i > r.idx);
        if (t === undefined) return [];
        // 회차 지점을 사이에 두면 되돌아오는 길이다. 회차 표식이 없는 노선만 방면 이름으로 가른다
        // (기점과 종점 이름이 같은 노선은 방면 이름이 양쪽 같다).
        const viaTurnaround =
          turnaroundIdx >= 0 ? r.idx < turnaroundIdx && t > turnaroundIdx : stops[r.idx].towards !== stops[t].towards;
        return [
          {
            boardAt: nm(stops[r.idx].name),
            ...(stops[r.idx].towards ? { towards: nm(stops[r.idx].towards) } : {}),
            alightAt: nm(stops[t].name),
            stopsAway: t - r.idx,
            viaTurnaround,
          },
        ];
      });
      const direct = rides.filter((r) => !r.viaTurnaround);
      // 타는 곳에서 앞으로 그 정류소가 없으면(이미 지난 정류소) 빈 목록 대신 그 사실을 싣는다.
      if (rides.length === 0) out.toStop = { ...(out.toStop as object), behindBoarding: true };
      else
        out.rides = (direct.length > 0 ? direct : rides).map(({ viaTurnaround, ...r }) =>
          viaTurnaround ? { ...r, viaTurnaround } : r,
        );
    }
    return finish();
  }

  if (refs.length > 0) {
    const next = refs
      .slice(0, 2)
      .map((r) => ({
        boardAt: nm(stops[r.idx].name),
        ...(stops[r.idx].towards ? { towards: nm(stops[r.idx].towards) } : {}),
        stops: stops.slice(r.idx + 1, r.idx + 1 + NEXT_STOPS).map((s) => nm(s.name)),
      }))
      .filter((n) => n.stops.length > 0);
    if (next.length > 0) out.nextStops = next;
    return finish();
  }

  // 타는 곳도 가려는 곳도 모른다.
  const some = someStops(stops, turnaroundIdx, nm);
  if (some) out.someStops = some;
  return finish();
}

/** 기점 다음부터 회차 지점(없으면 종점) 앞까지에서 고르게 뽑은 몇 곳. 뽑을 정류소가 없으면 null. */
function someStops(
  stops: readonly BusLineStop[],
  turnaroundIdx: number,
  nm: (name: string) => string,
): { towards?: string; stops: string[] } | null {
  const outbound = stops.slice(1, turnaroundIdx >= 0 ? turnaroundIdx : stops.length - 1);
  if (outbound.length === 0) return null;
  const n = Math.min(SAMPLE_STOPS, outbound.length);
  const picked = Array.from({ length: n }, (_, i) => outbound[Math.floor(((i + 0.5) * outbound.length) / n)]);
  return {
    ...(picked[0].towards ? { towards: nm(picked[0].towards) } : {}),
    stops: picked.map((s) => nm(s.name)),
  };
}
