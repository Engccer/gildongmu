/**
 * 채팅 도구 `plan_journey`(E70-b spec `2026-11-12-e70b-chat-journey-design.md` §4.2) — React/Next 비의존.
 *
 * 모델이 채우는 것은 여정 입력(이름·순서)뿐이다. 후보 역은 대중교통 경로에서만, 좌표·노선은 서버 검색에서만 나온다
 * (역을 지어낼 자리가 없다). 선정은 순수 함수(`journeyStationCandidates`·`pickJourneyStation`·`pickJourneyStop`)이고
 * 조회는 얇게 감싼다. 여정 조회는 라우트와 같은 진입 함수 `queryJourney` 하나만 지난다(D6).
 */
import { hasDataGoKrKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { haversineMeters } from "@/lib/geo";
import { displayStationName, exitQueryStationName } from "@/lib/journey/display";
import { journeyLineHint, journeyLineLabel } from "@/lib/journey/journey-lines";
import { journeyBudgetPrecheck, queryJourney } from "@/lib/journey/query";
import { sameLine } from "@/lib/journey/station-identity";
import { searchJourneyStops, stopSearchDeps } from "@/lib/journey/stop-search";
import { getTransitRoute } from "@/lib/providers/odsay";
import { searchPlaces } from "@/lib/providers/places";
import { isStation, normalizeStationName, parseStationQuery } from "@/lib/station-match";
import type { Coord, JourneyResult, JourneyStationInput, JourneyStopSearchResult, Place, TransitRoute } from "@/lib/types";
import { sourceFor } from "./sources";
import type { ExecutionContext, JourneyChatStation, ToolResult } from "./types";

export type JourneySide = "board" | "alight";

/** 후보 역 하나(D4). `side`: 그 역에서 대중교통을 타는 쪽(board)인지 내리는 쪽(alight)인지. */
export interface JourneyCandidate {
  name: string;
  line?: string;
  side: JourneySide;
}

/** 한쪽 후보 상한(D4). */
export const JOURNEY_CANDIDATES_PER_SIDE = 3;
/** 이름이 같은 역이 이보다 멀리 떨어져 있으면 다른 역이다(D3) — 노선 없이 고르지 않고 되묻는다. */
export const JOURNEY_AMBIGUOUS_STATION_M = 2000;
/** 승차 후보는 출발지에서, 하차 후보는 목적지에서 이 거리(m) 안이면 뺀다 — 걸어갈 역이다(잠정값). */
export const JOURNEY_CANDIDATE_MIN_M = 500;

/**
 * 후보 역(D4, 순수): 대중교통 추천 경로의 지하철·기차 구간에서만 뽑는다. 경로 순서, 한쪽에 최대 3곳.
 * - board: 구간마다 타는 역 = 첫 승차역과 환승역(마지막 하차역은 없다).
 * - alight: 구간마다 내리는 역 = 환승역과 마지막 하차역(첫 승차역은 없다).
 * - 쪽을 모르면 두 묶음을 `side` 표지로 갈라 함께 싣는다(board 먼저).
 * 버스만 타는 경로·경로 없음은 빈 목록이다.
 */
export function journeyStationCandidates(
  route: TransitRoute | null,
  side: JourneySide | undefined,
  ends: { origin: Coord; dest: Coord },
): JourneyCandidate[] {
  if (!route) return [];
  const rail = route.legs.filter((l) => l.mode === "subway");
  const of = (s: JourneySide): JourneyCandidate[] => {
    const seen = new Set<string>();
    const out: JourneyCandidate[] = [];
    for (const leg of rail) {
      const raw = s === "board" ? leg.fromName : leg.toName;
      if (!raw) continue;
      // 걸어갈 거리의 역은 자동차로 갈아탈 후보가 아니다(실호출 2026-11-12: 출발지 바로 앞 역 하나만 후보로 나왔다).
      // 정류 좌표가 없으면 거르지 않는다(모르는 것을 가깝다고 보지 않는다).
      const stop = s === "board" ? leg.stops?.[0] : leg.stops?.[leg.stops.length - 1];
      const end = s === "board" ? ends.origin : ends.dest;
      if (stop && haversineMeters(stop.lat, stop.lng, end.lat, end.lng) < JOURNEY_CANDIDATE_MIN_M) continue;
      const key = normalizeStationName(raw);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      const line = journeyLineLabel(leg.lineName);
      out.push({ name: `${displayStationName(raw)}역`, ...(line ? { line } : {}), side: s });
      if (out.length >= JOURNEY_CANDIDATES_PER_SIDE) break;
    }
    return out;
  };
  return side ? of(side) : [...of("board"), ...of("alight")];
}

export type JourneyStationPickResult =
  | { kind: "found"; station: JourneyChatStation }
  /** 동명 역이 멀리 떨어져 있거나 말한 노선의 역이 없다 — 조회하지 않고 노선을 되묻는다. */
  | { kind: "ambiguous"; lines: string[] }
  | { kind: "notFound" };

/**
 * 역 이름 → 장소 검색 결과에서 한 곳 선정(D3, 순수). 역(`isStation`)이면서 이름 키가 같은 결과만 본다.
 * - 노선이 있으면(인자 또는 이름 뒤 노선 토큰) 그 노선의 역 중 `near`에 가장 가까운 것. 그 노선의 역이 없으면 고르지 않는다.
 * - 노선이 없으면 `near`에 가장 가까운 것. 단 같은 이름의 역이 서로 2km 넘게 떨어져 둘 이상이면 고르지 않는다(동명 이역).
 * 다른 역으로 조용히 대체하지 않는다 — 못 고르면 `ambiguous`(노선 목록) 또는 `notFound`.
 */
export function pickJourneyStation(name: string, line: string | undefined, places: Place[], near: Coord): JourneyStationPickResult {
  const query = parseStationQuery(name);
  const wantLine = line?.trim() || query.lineHint;
  const same = places.filter((p) => isStation(p) && normalizeStationName(p.name) === query.nameKey);
  if (same.length === 0) return { kind: "notFound" };
  const lines = () => [...new Set(same.flatMap((p) => journeyLineLabel(journeyLineHint(p)) ?? []))];

  let pool = same;
  if (wantLine) {
    pool = same.filter((p) => {
      const l = journeyLineHint(p);
      return l !== undefined && sameLine(l, wantLine);
    });
    if (pool.length === 0) return lines().length > 0 ? { kind: "ambiguous", lines: lines() } : { kind: "notFound" };
  } else {
    const apart = same.some((a) => same.some((b) => haversineMeters(a.lat, a.lng, b.lat, b.lng) > JOURNEY_AMBIGUOUS_STATION_M));
    if (apart) return { kind: "ambiguous", lines: lines() };
  }
  const dist = (p: Place) => haversineMeters(p.lat, p.lng, near.lat, near.lng);
  const best = pool.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  // 노선을 말하지 않았으면 노선으로 좁히지 않는다: 장소 검색의 한 줄(「서울역 경의중앙선」)을 그대로 실으면 그 노선만 지정 역으로
  // 맞아 다른 노선(1호선)으로 가는 경로가 「지정 역 경로 없음」이 된다(실호출 2026-11-12). 같음 판정은 이름 + 500m가 맡는다.
  if (!wantLine) return { kind: "found", station: { label: `${displayStationName(best.name)}역`, lat: best.lat, lng: best.lng } };
  const bestLine = journeyLineHint(best);
  return { kind: "found", station: { label: best.name, lat: best.lat, lng: best.lng, ...(bestLine ? { line: bestLine } : {}) } };
}

export type JourneyStopPickResult =
  | { kind: "found"; station: JourneyChatStation }
  | { kind: "notFound" }
  /** 검색이 일부라도 실패했고 결과가 없다 — 「없다」가 아니라 「조회하지 못했다」. */
  | { kind: "failed" }
  /** 그 지역의 정류장 검색 대상을 찾지 못했다(데이터 미제공) — 「없다」가 아니다. */
  | { kind: "unsearched" };

/** 정류장 검색 결과에서 첫 결과 선정(D3, 순수, 3-state): 0건을 실패·미검색과 뭉개지 않는다. */
export function pickJourneyStop(result: JourneyStopSearchResult): JourneyStopPickResult {
  const hit = result.stops[0];
  if (hit) return { kind: "found", station: { label: hit.name, lat: hit.lat, lng: hit.lng, kind: "stop" } };
  if (result.failed) return { kind: "failed" };
  if (result.unsearched) return { kind: "unsearched" };
  return { kind: "notFound" };
}

/** 모델에 주는 여정 요약(D9): 변형별 총 시간·요금·갈아타는 역·대중교통 구간의 노선과 승하차역. 좌표·기하는 싣지 않는다. */
export function journeySummary(result: JourneyResult): Record<string, unknown> {
  const minutes = (seconds: number) => Math.round(seconds / 60);
  return {
    variants: result.variants.map((v, i) => {
      const egress = v.egress?.options[0];
      return {
        // 카드가 싣는 것은 첫 변형이다(D10).
        shownOnCard: i === 0,
        kind: v.kind,
        ...(v.boardStation ? { boardStation: v.boardStation.name } : {}),
        ...(v.alightStation ? { alightStation: v.alightStation.name } : {}),
        totalMinutes: v.totals.minutes,
        taxiFare: v.totals.taxiFare,
        transitFare: v.totals.transitFare,
        ...(v.taxiIn ? { taxiInMinutes: minutes(v.taxiIn.durationSeconds) } : {}),
        ...(egress ? { taxiOutMinutes: minutes(egress.taxiOut.durationSeconds) } : {}),
        transit: v.transit.legs
          .filter((l) => l.mode !== "walk")
          .map((l) => ({
            mode: l.mode,
            ...(l.lineName ? { line: l.lineName } : {}),
            ...(l.fromName ? { from: l.fromName } : {}),
            ...(l.toName ? { to: l.toName } : {}),
            minutes: l.minutes,
            ...(l.stationCount !== undefined ? { stationCount: l.stationCount } : {}),
          })),
      };
    }),
    // 지정한 역으로는 경로를 찾지 못해 추천 경로로 바뀐 쪽(카드의 못 찾음 줄과 같은 사실, D11).
    ...(result.designatedMissing ? { designatedMissing: result.designatedMissing.side } : {}),
  };
}

const NO_LOCATION = { error: "현재 위치를 알 수 없습니다." };
const OUT_OF_COVERAGE = { outOfCoverage: true, notice: "여정 조회는 대한민국 안에서 제공됩니다." };
const ASK_USER_FIRST = {
  askUserFirst: true,
  notice: "이 턴에는 갈아탈 역을 사용자에게 먼저 되물어야 합니다. 여정은 사용자가 역을 고른 다음 턴에 조회합니다.",
};
const TURN_LIMIT = { turnLimit: true, notice: "여정 조회는 한 턴에 한 번입니다. 이미 받은 결과로 답하세요." };
const RATE_LIMITED = {
  rateLimited: true,
  notice: "여정 조회 요청이 너무 많습니다. 잠시 후 다시 물어 달라고 안내하세요. 경로가 없다는 뜻이 아닙니다.",
};
const DAILY_BUDGET_EXHAUSTED = {
  dailyBudgetExhausted: true,
  notice: "오늘 여정 조회 한도를 다 썼습니다. 경로가 없다는 뜻이 아닙니다. 길찾기의 자동차·대중교통 조회는 쓸 수 있습니다.",
};

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

type SideResolution =
  | { kind: "found"; station: JourneyChatStation }
  | { kind: "marker"; data: Record<string, unknown>; asked?: true };

/** 한쪽 갈아탈 곳을 푼다(얇은 조회 + 순수 선정). 역 검색 실패는 throw(조회 실패), 정류장 검색 실패는 마커. */
async function resolveSide(
  side: JourneySide,
  name: string,
  line: string | undefined,
  kind: "station" | "stop",
  origin: Coord,
  dest: Coord,
): Promise<SideResolution> {
  const notFound = { kind: "marker" as const, data: { error: `'${name}' 위치를 찾지 못했습니다.` } };
  if (kind === "stop") {
    const unavailable = {
      kind: "marker" as const,
      data: { stopSearchUnavailable: true, name, notice: "이 지역은 정류장 이름 검색이 제공되지 않습니다. 정류장이 없다는 뜻이 아닙니다." },
    };
    if (!hasDataGoKrKey()) return unavailable;
    let picked: JourneyStopPickResult;
    try {
      picked = pickJourneyStop(await searchJourneyStops(name, [origin, dest], stopSearchDeps));
    } catch (e) {
      console.warn("[chat] 여정 정류장 검색 실패:", e);
      picked = { kind: "failed" };
    }
    if (picked.kind === "found") return picked;
    if (picked.kind === "unsearched") return unavailable;
    if (picked.kind === "failed") {
      return { kind: "marker", data: { stopSearchFailed: true, name, notice: "정류장을 조회하지 못했습니다. 정류장이 없다는 뜻이 아닙니다." } };
    }
    return notFound;
  }
  // 질의는 「{역 이름}역」 — 사용자가 「신도림」이라고만 말해도 동 이름이 아니라 역이 먼저 오게 한다. 좌표는 넘기지 않는다
  // (근접 블렌딩이 먼 동명 역을 밀어내면 동명 이역 판정이 사라진다).
  const found = await searchPlaces({ query: `${exitQueryStationName(name)}역`, lang: "ko" });
  const picked = pickJourneyStation(name, line, found.places, side === "board" ? origin : dest);
  if (picked.kind === "found") return picked;
  if (picked.kind === "ambiguous") {
    return {
      kind: "marker",
      asked: true,
      data: {
        ambiguousStation: { name, side, lines: picked.lines },
        notice: "이름이 같은 역이 여러 곳이거나 그 노선의 역을 찾지 못했습니다. 어느 노선의 역인지 사용자에게 되물으세요.",
      },
    };
  }
  return notFound;
}

/** 턴마다, 성공해서 지켜야 하는 자리(`asked`·`queried`). */
const KEPT = new WeakMap<object, Set<string>>();
function keptClaims(turn: object): Set<string> {
  let set = KEPT.get(turn);
  if (!set) KEPT.set(turn, (set = new Set()));
  return set;
}

const stationInput = (s: JourneyChatStation): JourneyStationInput => ({
  name: s.label,
  coord: { lat: s.lat, lng: s.lng },
  ...(s.line ? { line: s.line } : {}),
  ...(s.kind ? { kind: s.kind } : {}),
});

/**
 * `plan_journey` 실행. 결과는 `data`에서 갈린다: 찾음(`journey` 요약 + 카드) / 경로 없음(`journey: null`) / 되묻기
 * (`needStation`·`ambiguousStation`) / 턴 규칙 거절(`askUserFirst`·`turnLimit`) / 한도(`rateLimited`·`dailyBudgetExhausted`) /
 * 조회 실패(throw — 에이전트 루프가 오류 결과로 감싼다).
 */
export async function executePlanJourney(args: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
  // 선언 게이트(능력 신고·ko·키)가 이미 막지만 직접 호출 경로도 닫는다(이중 방어, D7).
  const j = ctx.journey;
  if (!j) return { data: { error: "이 대화에서는 여정 조회를 쓸 수 없습니다." } };
  const destination = text(args.destination);
  if (!destination) return { data: { error: "목적지가 필요합니다." } };
  const origin = ctx.userLocation;
  if (!origin) return { data: NO_LOCATION };
  if (!isInKorea(origin.lat, origin.lng)) return { data: OUT_OF_COVERAGE };

  const boardName = text(args.board_station);
  const alightName = text(args.alight_station);
  const askMode = !boardName && !alightName;

  // ── 턴 규칙(D5): 여기까지 await가 없다. 도구가 병렬로 돌아도 호출 순서대로 판정이 정해진다. ──
  if (askMode) {
    // 이미 여정을 조회한 턴에 후보를 더 주면 카드와 되묻기가 한 답에 섞인다.
    if (j.turn.queried) return { data: TURN_LIMIT };
  } else {
    // 후보·동명 역을 돌려준 턴에는 조회하지 않는다 — 채팅이 스스로 골라 조회하지 않는다(P2)를 실행부가 지킨다.
    if (j.turn.asked) return { data: ASK_USER_FIRST };
    if (j.turn.queried) return { data: TURN_LIMIT };
  }
  // 한도가 이미 소진됐으면 장소·정류장 검색도 내보내지 않는다(무기록 선판정, 턴 자리를 쓰지 않는다).
  if (!askMode) {
    const pre = journeyBudgetPrecheck(j.clientIp);
    if (pre === "rateLimited") return { data: RATE_LIMITED };
    if (pre === "budgetExhausted") return { data: DAILY_BUDGET_EXHAUSTED };
  }
  const claim = askMode ? "asked" : "queried";
  const before = j.turn[claim];
  j.turn[claim] = true;
  // 되묻기도 조회도 하지 못하고 끝나면(목적지·역을 못 찾음 등) 자리를 돌려준다 — 모델이 이름을 고쳐 다시 부를 수 있다.
  let keep = false;
  try {
    const destSearch = await searchPlaces({ query: destination, lang: ctx.dataLocale });
    const p = destSearch.places[0];
    if (!p) return { data: { error: `'${destination}' 위치를 찾지 못했습니다.` } };
    const dest = { lat: p.lat, lng: p.lng };
    if (!isInKorea(dest.lat, dest.lng)) return { data: OUT_OF_COVERAGE };

    if (askMode) {
      const side = args.transfer_side === "board" || args.transfer_side === "alight" ? args.transfer_side : undefined;
      // 정류 좌표(`stops`)가 있어야 걸어갈 거리의 역을 후보에서 뺄 수 있다 — 좌표는 옵트인 응답에만 실린다.
      const transit = await getTransitRoute({ origin, dest, includeStops: true });
      const candidates = journeyStationCandidates(transit?.recommended ?? null, side, { origin, dest });
      keep = true;
      return {
        data: { needStation: true, destination: p.name, candidates },
        source: candidates.length > 0 ? sourceFor("get_transit_route", ctx) : undefined,
      };
    }

    const kindOf = (v: unknown) => (v === "stop" ? ("stop" as const) : ("station" as const));
    const [board, alight] = await Promise.all([
      boardName ? resolveSide("board", boardName, text(args.board_line), kindOf(args.board_kind), origin, dest) : null,
      alightName ? resolveSide("alight", alightName, text(args.alight_line), kindOf(args.alight_kind), origin, dest) : null,
    ]);
    for (const r of [board, alight]) {
      if (r?.kind !== "marker") continue;
      if (r.asked) {
        j.turn.asked = true;
        keep = true;
      }
      return { data: r.data };
    }
    const boardStation = board?.kind === "found" ? board.station : null;
    const alightStation = alight?.kind === "found" ? alight.station : null;
    if ([boardStation, alightStation].some((s) => s && !isInKorea(s.lat, s.lng))) return { data: OUT_OF_COVERAGE };

    // 여기부터는 조회다 — 실패(throw)해도 유료 호출이 나갔을 수 있으므로 이 턴의 조회 자리를 쓴 것으로 둔다.
    keep = true;
    const outcome = await queryJourney(
      {
        from: origin,
        to: dest,
        ...(boardStation ? { board: stationInput(boardStation) } : {}),
        ...(alightStation ? { alight: stationInput(alightStation) } : {}),
        // 웹·iOS 길찾기 화면과 같은 질의(`stops=1` 늘) — [길찾기에서 열기]가 보여 줄 결과와 같은 것을 받는다.
        stops: true,
      },
      j.clientIp,
    );
    if (outcome.kind === "rateLimited") return { data: RATE_LIMITED };
    if (outcome.kind === "budgetExhausted") return { data: DAILY_BUDGET_EXHAUSTED };
    const src = sourceFor("plan_journey", ctx);
    if (outcome.result.variants.length === 0) return { data: { destination: p.name, journey: null }, source: src };
    return {
      data: { destination: p.name, journey: journeySummary(outcome.result) },
      render: {
        type: "journey",
        result: outcome.result,
        origin: { lat: origin.lat, lng: origin.lng },
        queriedAt: Date.now(),
        manualOrigin: j.manualOrigin,
        board: boardStation,
        alight: alightStation,
        dest,
        destLabel: p.name,
        destRoman: p.nameRoman ?? null,
      },
      source: src,
    };
  } finally {
    // 자리를 지킨 호출은 다른 호출이 되돌리지 못하게 표시한다: 병렬 호출 둘 중 하나가 실패해 스냅숏으로 되돌리면
    // 성공한 쪽이 세운 `asked`가 풀려 같은 턴에 조회가 통과한다(리뷰 S1).
    if (keep) {
      keptClaims(j.turn).add(claim);
      // 먼저 실패한 병렬 호출이 이미 되돌렸을 수 있다 — 지킨 자리는 다시 세운다.
      j.turn[claim] = true;
    }
    else if (!keptClaims(j.turn).has(claim)) j.turn[claim] = before;
  }
}
