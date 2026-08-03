/**
 * 자동차 안내 기하 조립(B1 스펙 §5) — `includeGeometry=1` 응답의 guides를
 * 경로 추종 리듀서가 먹는 `GuideRoute`로 투영한다. Kit 미러: `CarRouteGuide.swift`.
 *
 * fail-closed: 어느 guide든 기하가 결손이면 부분 조립 없이 전체 null이다.
 * 부분 상세는 중간부터 틀린 도로에 스냅해 이탈 판정이 영영 못 잡는 거짓 안내가
 * 된다. 이음매·0-길이 검증은 `buildGuideRoute`가 두 번째 층으로 다시 본다.
 *
 * 도로명 스팬은 별도 축이다: 링크 길이 누적 합이 경로 총거리와 5% 이상 어긋나면
 * 도로명 기능만 강등(빈 배열)하고 경로 안내는 유지한다 — 어긋난 스팬으로 "지금
 * 어느 도로"를 말하는 것이 가짜 정밀이고, 경로 추종 자체는 폴리라인만으로 성립한다.
 */
import { buildGuideRoute, type GuideRoute } from "./route-geometry";
import type { CarRouteBriefing } from "./types";

/** 도로명 스팬 — 진행거리 [startD, endD) 구간의 도로명(무명 링크는 null). */
export interface CarRoadSpan {
  name: string | null;
  startD: number;
  endD: number;
}

export interface CarGuideData {
  route: GuideRoute;
  roadSpans: CarRoadSpan[];
}

const ROAD_SPAN_TOLERANCE_RATIO = 0.05;

export function buildCarGuide(briefing: CarRouteBriefing): CarGuideData | null {
  const guides = briefing.guides;
  if (guides.length === 0) return null;
  // fail-closed: 기하 결손 guide가 하나라도 있으면 전체 부적격.
  for (const g of guides) {
    if (!g.pathCoords || g.pathCoords.length < 2) return null;
    for (const c of g.pathCoords) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return null;
    }
  }

  const route = buildGuideRoute(
    guides.map((g) => ({ description: g.guidance, pathCoords: g.pathCoords! })),
  );
  if (!route) return null;

  // 도로명 스팬: 링크 길이를 경로 진행거리 축에 누적한다.
  const links = guides.flatMap((g) => g.roadLinks ?? []);
  let acc = 0;
  const roadSpans: CarRoadSpan[] = [];
  for (const link of links) {
    if (!Number.isFinite(link.distanceMeters) || link.distanceMeters < 0) {
      return { route, roadSpans: [] };
    }
    roadSpans.push({ name: link.name, startD: acc, endD: acc + link.distanceMeters });
    acc += link.distanceMeters;
  }
  // 누적 합이 총거리와 5% 이상 어긋나면 도로명 강등(경로 안내는 유지).
  if (
    roadSpans.length === 0 ||
    Math.abs(acc - route.totalMeters) > route.totalMeters * ROAD_SPAN_TOLERANCE_RATIO
  ) {
    return { route, roadSpans: [] };
  }
  return { route, roadSpans };
}

/** 진행거리 d가 속한 스팬의 도로명. 무명 스팬·빈 스팬·범위 밖은 null. */
export function roadNameAt(spans: CarRoadSpan[], d: number): string | null {
  for (const s of spans) {
    if (d >= s.startD && d < s.endD) return s.name;
  }
  // 종점 등호 경계: 마지막 스팬의 끝은 마지막 스팬 소속으로 본다.
  const last = spans[spans.length - 1];
  if (last && d === last.endD) return last.name;
  return null;
}
