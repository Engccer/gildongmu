import type { TransitHighlight, TransitRoute, TransitRouteResult } from "../types";

/**
 * 대안 경로 선정과 축 라벨(spec §3.3).
 *
 * 파이프라인 순서가 계약이다: 정규화(전체) → 강등(전체) → **선정** → **라벨**.
 * 선정을 강등보다 앞에 두면 선정 밖의 유일한 운행 중 경로를 영영 못 본다.
 * 라벨을 선정보다 앞에 두면 강등이 1순위를 바꿨을 때 축의 기준점이 낡는다.
 */

/** 추천 1 + 대안 4. 접힘 버튼이 화면을 채우지 않는 선(위원장 판정) */
export const MAX_TRANSIT_ROUTES = 5;

/** 그 경로에 운행 종료가 확정된 탑승 구간이 있는가 */
function isOutside(route: TransitRoute): boolean {
  return route.legs.some((l) => l.serviceStatus === "outside");
}

/** pool에서 기준보다 나은 것 중 최소값을 가진 첫 경로(정렬 순서 보존) */
function pickBest(
  pool: TransitRoute[],
  value: (r: TransitRoute) => number,
  baseline: number,
): TransitRoute | undefined {
  let best: TransitRoute | undefined;
  for (const r of pool) {
    if (value(r) >= baseline) continue;
    if (!best || value(r) < value(best)) best = r;
  }
  return best;
}

const minutesOf = (r: TransitRoute) => r.summary.totalMinutes;
const transfersOf = (r: TransitRoute) => r.summary.transfers;

/**
 * 강등 정렬된 전체 경로에서 표시할 5개를 고른다.
 * 축 후보는 운행 종료가 아닌 경로로 제한한다 (권할 수 없는 경로를 권유 자리에
 * 올리지 않는다. 접힌 라벨에는 운행 상태가 안 보인다).
 */
export function selectTransitRoutes(routes: TransitRoute[]): TransitRoute[] {
  if (routes.length <= 1) return routes.slice();
  const [base, ...pool] = routes;
  const axisPool = pool.filter((r) => !isOutside(r));
  const picked = [
    pickBest(axisPool, transfersOf, transfersOf(base)),
    pickBest(axisPool, minutesOf, minutesOf(base)),
  ].filter((r): r is TransitRoute => r != null);

  const selected: TransitRoute[] = [base];
  const seen = new Set([base.routeKey]);
  for (const r of picked) {
    if (seen.has(r.routeKey)) continue;
    seen.add(r.routeKey);
    selected.push(r);
  }
  for (const r of pool) {
    if (selected.length >= MAX_TRANSIT_ROUTES) break;
    if (seen.has(r.routeKey)) continue;
    seen.add(r.routeKey);
    selected.push(r);
  }
  return selected;
}

/**
 * 최종 순서가 확정된 뒤 1순위를 기준으로 축을 판정해 라벨과 표시 번호를 싣는다.
 * 1순위 자신은 라벨을 갖지 않는다(자기보다 나은 자기는 없다).
 */
export function annotateHighlights(
  selected: TransitRoute[],
  totalCandidates: number,
): TransitRouteResult {
  const [recommended, ...alternatives] = selected;
  const axisPool = alternatives.filter((r) => !isOutside(r));
  const fewest = pickBest(axisPool, transfersOf, transfersOf(recommended));
  const fastest = pickBest(axisPool, minutesOf, minutesOf(recommended));

  let nextIndex = 1;
  const annotated = alternatives.map((route) => {
    const highlight: TransitHighlight[] = [];
    if (fewest?.routeKey === route.routeKey) highlight.push("fewestTransfers");
    if (fastest?.routeKey === route.routeKey) highlight.push("fastest");
    if (highlight.length > 0) return { ...route, highlight };
    return { ...route, displayIndex: nextIndex++ };
  });

  return { recommended, alternatives: annotated, totalCandidates };
}
