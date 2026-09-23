import type { TransitHighlight, TransitModeAxis, TransitRoute, TransitRouteResult, TransitVehicle } from "../types";

/**
 * 대안 경로 선정과 축 라벨(spec `2026-09-24-transit-alternatives-reasoned-design.md` §2, 원설계 2026-08-07 §3.3).
 *
 * 파이프라인 순서가 계약이다: 정규화(전체) → 강등(전체) → **선정** → **라벨**.
 * 선정을 강등보다 앞에 두면 선정 밖의 유일한 운행 중 경로를 영영 못 본다.
 * 라벨을 선정보다 앞에 두면 강등이 1순위를 바꿨을 때 축의 기준점이 낡는다.
 *
 * **이유 있는 대안만 싣는다**(E50 판정 1): 대안은 축 이름이 붙는 경로뿐이고 번호로 채우지 않는다.
 * 그래서 목록 길이는 1(추천만)에서 1 + 축 수까지 그때그때 다르다.
 */

/**
 * 그 경로에 운행 종료가 확정된 탑승 구간이 있는가.
 * 강등 정렬(`annotateServiceStatus`)과 축 제외가 **이 술어 하나**를 쓴다(A21) — `unknown`은
 * 어느 쪽에도 참여하지 않는다(조회 실패를 결함으로 단정하면 멀쩡한 경로가 강등되고, 선정 절단과
 * 결합하면 강등이 곧 제외다: TAGO가 노선째 0행인 4호선이 하루 종일 그랬다).
 */
export function isOutside(route: TransitRoute): boolean {
  return route.legs.some((l) => l.serviceStatus === "outside");
}

type Key = (r: TransitRoute) => number;

const minutesOf: Key = (r) => r.summary.totalMinutes;
const transfersOf: Key = (r) => r.summary.transfers;
/** 도보 거리 모르는 경로는 도보 축에 참여하지 않는다(3-state — 모름을 0m로 읽지 않는다). */
const walkMetersOf: Key = (r) => r.summary.walkMeters ?? Number.POSITIVE_INFINITY;
const walkMinutesOf: Key = (r) => r.summary.walkMinutes;

interface AxisRule {
  axis: TransitHighlight;
  /** 1순위 대비 이 축의 자격(엄격히 나을 때만) */
  eligible: (r: TransitRoute, base: TransitRoute) => boolean;
  /** 자격 있는 후보 중 고르는 순서: 앞 키부터 작은 쪽, 전부 같으면 순위(정렬 순서)가 앞선 쪽 */
  keys: Key[];
}

/**
 * 축 5개(E50). 동률 2차 키는 "그 축의 이유를 해치지 않는 가장 가까운 비용"이다:
 * 환승이 같으면 빠른 쪽(dodo `pickBest` 규칙), 시간이 같으면 환승이 적은 쪽, 도보 거리가 같으면 도보 분이 짧은 쪽
 * 다음 빠른 쪽(이름이 도보를 말하므로 요약이 말하는 도보 분을 먼저 본다, 설계 리뷰 #4),
 * 수단 축은 그 수단 안에서 빠른 쪽 → 환승이 적은 쪽.
 */
const AXIS_RULES: AxisRule[] = [
  {
    axis: "fastest",
    eligible: (r, base) => minutesOf(r) < minutesOf(base),
    keys: [minutesOf, transfersOf],
  },
  {
    axis: "fewestTransfers",
    eligible: (r, base) => transfersOf(r) < transfersOf(base),
    keys: [transfersOf, minutesOf],
  },
  {
    axis: "leastWalk",
    // 거리로 판정하되 화면이 말하는 도보 **분**이 1순위보다 늘면 자격이 없다 — 이름("도보 거리가 가장
    // 짧은")과 요약("도보 N분")이 거꾸로 들리는 경로를 권하지 않는다(환승 통로 0m가 분에만 들어간다).
    eligible: (r, base) =>
      base.summary.walkMeters != null &&
      r.summary.walkMeters != null &&
      r.summary.walkMeters < base.summary.walkMeters &&
      r.summary.walkMinutes <= base.summary.walkMinutes,
    keys: [walkMetersOf, walkMinutesOf, minutesOf],
  },
  {
    axis: "busOnly",
    // 수단 축은 범주형이라 "엄격히 나음"은 "1순위가 그 수단이 아님"이다.
    eligible: (r, base) => r.vehicle === "bus" && base.vehicle !== "bus",
    keys: [minutesOf, transfersOf],
  },
  {
    axis: "subwayOnly",
    eligible: (r, base) => r.vehicle === "subway" && base.vehicle !== "subway",
    keys: [minutesOf, transfersOf],
  },
];

/** 이름 조립 순서의 정본(웹·Kit·`:kit` 이름 함수가 같은 순서를 쓴다) */
export const AXIS_ORDER: TransitHighlight[] = AXIS_RULES.map((r) => r.axis);

/**
 * pool(순위 순서)에서 자격 있는 것 중 키가 가장 작은 첫 경로. 키가 전부 같으면 앞선 것이 이긴다.
 * ⚠ pool은 반드시 순위 순서여야 한다 — 선정과 라벨이 같은 경로를 고르는 근거가 그것이다.
 */
function pickBest(pool: TransitRoute[], base: TransitRoute, rule: AxisRule): TransitRoute | undefined {
  let best: TransitRoute | undefined;
  for (const r of pool) {
    if (!rule.eligible(r, base)) continue;
    if (!best || isLess(r, best, rule.keys)) best = r;
  }
  return best;
}

function isLess(a: TransitRoute, b: TransitRoute, keys: Key[]): boolean {
  for (const key of keys) {
    const d = key(a) - key(b);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** 축 후보는 운행 종료가 아닌 경로로 제한한다(권할 수 없는 경로를 이름 붙은 자리에 올리지 않는다). */
function axisPicks(base: TransitRoute, pool: TransitRoute[]): Map<TransitHighlight, TransitRoute> {
  const axisPool = pool.filter((r) => !isOutside(r));
  const picks = new Map<TransitHighlight, TransitRoute>();
  for (const rule of AXIS_RULES) {
    const best = pickBest(axisPool, base, rule);
    if (best) picks.set(rule.axis, best);
  }
  return picks;
}

/**
 * 강등 정렬된 전체 경로에서 표시할 경로를 고른다: 1순위 + 축마다 가장 나은 경로(중복 제거).
 * 결과는 **순위 순서**다(축 순서가 아니다) — 라벨 단계가 같은 동률 판정을 재현하려면 필요하다.
 */
export function selectTransitRoutes(routes: TransitRoute[]): TransitRoute[] {
  if (routes.length <= 1) return routes.slice();
  const [base, ...pool] = routes;
  const chosen = new Set([...axisPicks(base, pool).values()].map((r) => r.routeKey));
  return [base, ...pool.filter((r) => chosen.has(r.routeKey))];
}

/** 이 축들은 옛 앱(스토어 1.18·1.19 Kit)이 이름을 안다. 나머지 축만 가진 대안엔 옛 앱용 번호를 싣는다. */
const LEGACY_AXES: TransitHighlight[] = ["fastest", "fewestTransfers"];

/**
 * 최종 목록이 확정된 뒤 1순위를 기준으로 축을 판정해 라벨을 싣는다.
 * 1순위 자신은 라벨을 갖지 않는다(자기보다 나은 자기는 없다).
 *
 * `displayIndex`는 **옛 앱 호환 전용**이다(spec §3.2): 옛 Kit은 모르는 축을 무시하고 "대안 경로 N"으로
 * 떨어지므로, 옛 앱이 아는 축이 하나도 없는 대안에만 표시 순서대로 1부터 싣는다. 새 클라이언트는 아는
 * 축이 있으면 이 값을 보지 않는다.
 */
export function annotateHighlights(selected: TransitRoute[], candidates: TransitRoute[]): TransitRouteResult {
  const [recommended, ...alternatives] = selected;
  const picks = axisPicks(recommended, alternatives);

  let legacyIndex = 1;
  const annotated = alternatives.map((route) => {
    const highlight = AXIS_ORDER.filter((axis) => picks.get(axis)?.routeKey === route.routeKey);
    const base = highlight.length > 0 ? { ...route, highlight } : route;
    return highlight.some((a) => LEGACY_AXES.includes(a)) ? base : { ...base, displayIndex: legacyIndex++ };
  });

  const offers = requeryAxesFor(candidates);
  return {
    recommended,
    alternatives: annotated,
    totalCandidates: candidates.length,
    ...(offers.length > 0 ? { requeryAxes: offers } : {}),
  };
}

const MODE_AXES: { axis: TransitModeAxis; vehicle: TransitVehicle }[] = [
  { axis: "busOnly", vehicle: "bus" },
  { axis: "subwayOnly", vehicle: "subway" },
];

/**
 * 재조회를 제안할 수단 축: **강등 뒤 전체 후보**(운행 종료 포함) 어디에도 그 수단만 타는 경로가 없을 때만
 * (E50 판정 2, spec §3). 버튼이 뜨는 조건의 정본은 서버다(웹·iOS가 같은 목록을 읽는다).
 * ⚠ 표시 집합으로 판정하지 말 것 — 운행 종료라 축에서 빠진 그 수단 경로가 후보에 있으면, 재조회는 서버가 이미
 *   쥔 그 경로를 돈(ODsay 호출당 과금)을 내고 다시 받아 올 뿐이다(설계 리뷰 #1).
 */
export function requeryAxesFor(candidates: TransitRoute[]): TransitModeAxis[] {
  return MODE_AXES.filter(({ vehicle }) => !candidates.some((r) => r.vehicle === vehicle)).map((m) => m.axis);
}

/** 게이트·테스트용 — 완성된 결과에서 재조회 제안 목록을 다시 읽는다. */
export function modeRequeryOffers(result: TransitRouteResult): TransitModeAxis[] {
  return result.requeryAxes ?? [];
}

/** 수단 재조회 응답에서 그 수단만 타는 경로만 남긴다(ODsay 필터를 믿되 교차 확인한다). */
export function filterRoutesByMode(routes: TransitRoute[] | null, vehicle: TransitVehicle): TransitRoute[] {
  return (routes ?? []).filter((r) => r.vehicle === vehicle);
}

/** `SearchPathType` 값(ODsay: 1 지하철·2 버스) ↔ 수단 축 */
export const SEARCH_PATH_TYPE: Record<TransitModeAxis, "1" | "2"> = { subwayOnly: "1", busOnly: "2" };
export const VEHICLE_OF_AXIS: Record<TransitModeAxis, TransitVehicle> = { subwayOnly: "subway", busOnly: "bus" };
