import { getWalkRouteBriefing } from "./providers/tmap-pedestrian";
import { hasAudioSignalNear } from "./providers/audio-signals";
import type { Coord, WalkRouteBriefing } from "./types";

/**
 * 도보 경로 서비스 진입점(라우트·채팅 공용 — provider 직접 호출 금지, walk-infra.ts 동형).
 *
 * Tmap 브리핑의 횡단보도 단계에 음향신호기 주석을 붙인다. 매칭 규칙(spec
 * 2026-07-28 실측 확정): description "횡단보도" 포함 AND 단계 좌표 40m 내
 * seed 존재 — 실측 분포가 4~15m(신호기 있는 횡단보도) vs 127m+(무관 단계)로
 * 완전 분리라 두 게이트 결합이 오탐·미탐을 모두 차단한다. positive-only:
 * 미등록 신호기를 반증할 수 없으므로 "없음"은 표기하지 않는다(침묵).
 * 주석 후 모든 단계에서 coord를 제거해 API 응답 스키마를 기존과 동일하게 유지한다.
 */

const ANNOTATION = "음향신호기 있음"; // 도보 경로는 V1 ko 전용 — i18n 키 불필요
const MATCH_RADIUS_METERS = 40;

export function annotateAudioSignals(briefing: WalkRouteBriefing): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { coord, ...rest } = step;
    if (
      coord &&
      rest.description.includes("횡단보도") &&
      hasAudioSignalNear(coord.lat, coord.lng, MATCH_RADIUS_METERS)
    ) {
      return { ...rest, description: `${rest.description}, ${ANNOTATION}` };
    }
    return rest;
  });
  return { ...briefing, steps };
}

/** 도보 경로 조회(주석 포함). 경로 없으면 null(provider graceful 계약 그대로). */
export async function getWalkRoute(params: {
  origin: Coord;
  dest: Coord;
}): Promise<WalkRouteBriefing | null> {
  const briefing = await getWalkRouteBriefing(params);
  return briefing ? annotateAudioSignals(briefing) : null;
}
