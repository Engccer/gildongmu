import { getKakaoWalkBriefing } from "./providers/kakao-walk";
import { getWalkRouteBriefing } from "./providers/tmap-pedestrian";
import { hasAudioSignalNear } from "./providers/audio-signals";
import { hasKakaoKey, hasTmapKey } from "./env";
import { logRouteFallback } from "./route-fallback-log";
import type { Coord, StepFreeStatus, WalkRouteBriefing } from "./types";

/**
 * 도보 경로 서비스 진입점(라우트·채팅 공용 — provider 직접 호출 금지, walk-infra.ts 동형).
 * 기본 카카오, 카카오 throw 시에만 Tmap 폴백(spec 2026-07-29 위원장 판정).
 * 경로 없음(null)은 폴백하지 않는다: 폴백은 가용성 장치이지 커버리지 보강이 아니다.
 *
 * 음향신호기 주석(annotateAudioSignals) 매칭 규칙(spec 2026-07-29 재캘리브레이션):
 * description "횡단보도" 포함 AND 병합 표현("2개의 횡단보도 이용" 류) 아님 AND
 * 후보점(카카오 pathCoords 전체 또는 Tmap 단일 coord) 중 하나라도 40m 내 seed
 * 존재 — 실측 분포가 32.5m 이하(양성 군) vs 91m 이상(무관 단계)로 완전 분리라
 * 두 게이트 결합이 오탐·미탐을 모두 차단한다. positive-only: 미등록 신호기를
 * 반증할 수 없으므로 "없음"은 표기하지 않는다(침묵). 병합 스텝은 seed 1개
 * 매칭으로 문장 전체에 붙이면 나머지 횡단보도에도 있다는 거짓 안전 정보가
 * 되므로 주석을 생략한다. 주석 후 모든 단계에서 coord·pathCoords를 제거해
 * API 응답 스키마를 기존과 동일하게 유지한다.
 */

const ANNOTATION = "음향신호기 있음"; // 도보 경로는 V1 ko 전용 — i18n 키 불필요
const MATCH_RADIUS_METERS = 40;
/** "2개의 횡단보도 이용" 류 병합 스텝 — 어느 횡단보도인지 특정 불가라 주석 생략. */
const MERGED_CROSSWALK = /\d+개의/;

/** 계단 회피 미적용 시 브리핑 맨 앞에 삽입하는 안전 문장(모든 소비자 결정론 전달). */
const STEP_FREE_NOTICE: Record<Exclude<StepFreeStatus, "applied">, string> = {
  no_stepfree_route:
    "계단 없는 경로를 찾지 못해 일반 경로를 안내합니다. 계단이 포함될 수 있습니다.",
  unavailable:
    "계단 회피 경로를 조회하지 못했습니다. 일반 경로를 안내하며 계단이 포함될 수 있습니다.",
};

export function annotateAudioSignals(briefing: WalkRouteBriefing): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { coord, pathCoords, ...rest } = step;
    // 판정 후보점: 카카오 폴리라인 전체(재캘리브레이션 2026-07-29 — 첫 점만으로는
    // 진입 전 시작점이 신호기와 멀어 미탐) 또는 Tmap 단일 Point.
    const candidates = pathCoords ?? (coord ? [coord] : []);
    if (
      candidates.length > 0 &&
      rest.description.includes("횡단보도") &&
      !MERGED_CROSSWALK.test(rest.description) &&
      candidates.some((c) => hasAudioSignalNear(c.lat, c.lng, MATCH_RADIUS_METERS))
    ) {
      return { ...rest, description: `${rest.description}, ${ANNOTATION}` };
    }
    return rest;
  });
  return { ...briefing, steps };
}

/** 안전 문장을 스텝 0번에 삽입한다(기존 문장 개변 금지 — 별도 스텝). */
function withStepFree(
  briefing: WalkRouteBriefing,
  status: StepFreeStatus,
): WalkRouteBriefing {
  if (status === "applied") return { ...briefing, stepFree: status };
  return {
    ...briefing,
    stepFree: status,
    steps: [{ description: STEP_FREE_NOTICE[status] }, ...briefing.steps],
  };
}

async function fetchPrimaryOrFallback(params: {
  origin: Coord;
  dest: Coord;
  accessible: boolean;
}): Promise<{ briefing: WalkRouteBriefing | null; via: "kakao" | "tmap" } | null> {
  const { origin, dest, accessible } = params;
  if (hasKakaoKey()) {
    try {
      return { briefing: await getKakaoWalkBriefing({ origin, dest, accessible }), via: "kakao" };
    } catch (e) {
      if (!hasTmapKey()) throw e;
      logRouteFallback("[walk-route] 카카오 실패, Tmap 폴백:", origin, dest, e);
      return { briefing: await getWalkRouteBriefing({ origin, dest }), via: "tmap" };
    }
  }
  if (hasTmapKey()) {
    return { briefing: await getWalkRouteBriefing({ origin, dest }), via: "tmap" };
  }
  return null; // 게이트(hasWalkRouteKey)가 먼저 막지만 이중 방어
}

export async function getWalkRoute(params: {
  origin: Coord;
  dest: Coord;
  accessible?: boolean;
}): Promise<WalkRouteBriefing | null> {
  const { origin, dest, accessible = false } = params;

  if (!accessible) {
    const r = await fetchPrimaryOrFallback({ origin, dest, accessible: false });
    return r?.briefing ? annotateAudioSignals(r.briefing) : null;
  }

  // 계단 회피: 카카오 전용. Tmap 경유(폴백·단독)는 동등 모드가 없어 unavailable.
  const r = await fetchPrimaryOrFallback({ origin, dest, accessible: true });
  if (!r) return null;
  if (r.via === "tmap") {
    return r.briefing ? withStepFree(annotateAudioSignals(r.briefing), "unavailable") : null;
  }
  if (r.briefing) {
    // applied fail-closed: ACCESSIBLE 응답에 계단 문구가 남아 있으면 안전 선언 금지.
    const hasStairs = r.briefing.steps.some((s) => s.description.includes("계단"));
    return withStepFree(
      annotateAudioSignals(r.briefing),
      hasStairs ? "no_stepfree_route" : "applied",
    );
  }
  // 무계단 경로 부재(ROUTE_RESULT_NOT_FOUND): 기본 모드 재호출(같은 fetch 캐시 공유).
  const base = await fetchPrimaryOrFallback({ origin, dest, accessible: false });
  if (!base?.briefing) return null;
  return withStepFree(
    annotateAudioSignals(base.briefing),
    base.via === "tmap" ? "unavailable" : "no_stepfree_route",
  );
}
