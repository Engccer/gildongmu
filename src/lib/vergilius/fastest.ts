/**
 * 한 질문에서 경로 조회를 여러 수단으로 불렀을 때 가장 빠른 수단을 서버가 정한다(E82 답변 모델 판정 ④, 2026-11-15 위원장).
 * 모델은 숫자 비교를 틀린다(Haiku q7: 버스 17분을 자동차 13분보다 빠르다고 했다) — 비교는 코드가 하고 모델은 말로 옮긴다.
 * React/Next 비의존.
 *
 * - 비교 단위는 들리는 분(반올림)이다. 같은 분이면 수단을 함께 싣는다(초로 가르면 「13분이 13분보다 빠르다」가 된다).
 * - 도착지(`destination`, 실행부가 검색해 정한 이름)가 같은 결과끼리만 잰다.
 * - 시간이 없는 결과(오류, 경로 없음, 자동차 0초=미제공)는 비교에서 빠진다. 시간이 있는 수단이 둘 이상일 때만 싣는다.
 * - 대중교통은 추천과 대안 가운데 가장 짧은 경로로 잰다.
 */
import type { VergiliusToolOutcome } from "./types";

/** 결과에 덧붙이는 필드 이름. 지침(`instruction.ts`)이 이 이름으로 가리킨다. */
export const FASTEST_FIELD = "fastestAmongQueried";

export type RouteMode = "walk" | "transit" | "car";

const MODE_BY_TOOL: Readonly<Record<string, RouteMode>> = {
  get_walk_route: "walk",
  get_transit_route: "transit",
  get_car_route: "car",
};

/** 한 질문 동안 모은 도착지별·수단별 분. 회차를 넘어 같은 객체를 넘긴다. */
export type RouteMinutesSeen = Map<string, Map<RouteMode, number>>;

export interface FastestAmongQueried {
  modes: RouteMode[];
  minutes: number;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** 경로 결과 하나의 분. 시간이 없으면 null. */
function routeMinutes(mode: RouteMode, response: Record<string, unknown>): number | null {
  if (mode === "walk") {
    const seconds = positive(response.durationSeconds);
    return seconds === null ? null : Math.round(seconds / 60);
  }
  if (mode === "car") {
    const seconds = positive(record(response.briefing)?.durationSeconds);
    return seconds === null ? null : Math.round(seconds / 60);
  }
  const route = record(response.route);
  if (!route) return null;
  const candidates = [route.recommended, ...(Array.isArray(route.alternatives) ? route.alternatives : [])];
  const minutes = candidates
    .map((c) => positive(record(record(c)?.summary)?.totalMinutes))
    .filter((m): m is number => m !== null);
  return minutes.length > 0 ? Math.min(...minutes) : null;
}

function fastestOf(byMode: Map<RouteMode, number>): FastestAmongQueried | null {
  if (byMode.size < 2) return null;
  const minutes = Math.min(...byMode.values());
  return { modes: [...byMode].filter(([, m]) => m === minutes).map(([mode]) => mode), minutes };
}

/**
 * 이 회차의 도구 결과에 가장 빠른 수단(`FASTEST_FIELD`)을 덧붙인 새 배열을 낸다. 붙는 자리는 시간이 있는 경로 결과뿐이다.
 * `seen`은 앞 회차의 경로 결과를 기억한다(이 함수가 채운다).
 */
export function annotateFastestRoute(
  outcomes: readonly VergiliusToolOutcome[],
  seen: RouteMinutesSeen,
): VergiliusToolOutcome[] {
  const timed = outcomes.map((o) => {
    const mode = MODE_BY_TOOL[o.call.name];
    const destination = typeof o.response.destination === "string" ? o.response.destination : null;
    if (mode === undefined || destination === null) return null;
    const minutes = routeMinutes(mode, o.response);
    return minutes === null ? null : { mode, destination, minutes };
  });

  for (const t of timed) {
    if (!t) continue;
    const byMode = seen.get(t.destination) ?? new Map<RouteMode, number>();
    const before = byMode.get(t.mode);
    byMode.set(t.mode, before === undefined ? t.minutes : Math.min(before, t.minutes));
    seen.set(t.destination, byMode);
  }

  return outcomes.map((o, i) => {
    const t = timed[i];
    const fastest = t ? fastestOf(seen.get(t.destination)!) : null;
    return fastest ? { ...o, response: { ...o.response, [FASTEST_FIELD]: fastest } } : o;
  });
}
