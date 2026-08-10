import { getKakaoWalkBriefing } from "./providers/kakao-walk";
import { getWalkRouteBriefing } from "./providers/tmap-pedestrian";
import { hasAudioSignalNear } from "./providers/audio-signals";
import { hasKakaoKey, hasTmapKey } from "./env";
import { logRouteFallback } from "./route-fallback-log";
import { rewriteWalkBriefing } from "./walk-guidance";
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
/**
 * 병합 스텝 — 어느 횡단보도인지 특정 불가라 주석 생략.
 * ⚠ 두 형태를 모두 받는다: 카카오 원문 "2개의 횡단보도"와 재작성본 "횡단보도 2개"
 * (`rewriteWalkGuidance`). 원문형만 보면 재작성 뒤 이 게이트가 조용히 열려
 * **신호기 없는 횡단보도에 "음향신호기 있음"이 붙는다** — 침묵보다 나쁜
 * 거짓 안전 정보다. Tmap 폴백 문장은 재작성을 거치지 않으므로 원문형도 남긴다.
 */
const MERGED_CROSSWALK = /\d+개의|횡단보도 \d+개/;

/** 계단 회피 미적용 시 전달하는 안전 문장(모든 소비자 결정론 전달). */
const STEP_FREE_NOTICE: Record<Exclude<StepFreeStatus, "applied">, string> = {
  // ⚠ 이 상태는 두 분기가 공유한다: ACCESSIBLE 응답의 계단 문구 잔존(fail-closed —
  // 반환은 ACCESSIBLE 경로)과 무계단 경로 부재 후 기본 모드 재호출(반환은 일반 경로).
  // 그래서 어느 경로를 반환하는지 단정하지 않는다 — 문장의 역할은 경로 설명이
  // 아니라 계단 경고다(spec §2.6, 종전 "일반 경로를 안내합니다"는 앞 분기에서 거짓).
  no_stepfree_route:
    "계단 없는 경로를 확정하지 못했습니다. 안내 경로에 계단이 포함될 수 있습니다.",
  // 이 분기는 실제로 일반 경로를 반환하므로 종전 문장이 참이다.
  unavailable:
    "계단 회피 경로를 조회하지 못했습니다. 일반 경로를 안내하며 계단이 포함될 수 있습니다.",
};

export function annotateAudioSignals(
  briefing: WalkRouteBriefing,
  keepGeometry = false,
): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { coord, pathCoords, ...rest } = step;
    // 판정 후보점: 카카오 폴리라인 전체(재캘리브레이션 2026-07-29 — 첫 점만으로는
    // 진입 전 시작점이 신호기와 멀어 미탐) 또는 Tmap 단일 Point.
    const candidates = pathCoords ?? (coord ? [coord] : []);
    const annotated =
      candidates.length > 0 &&
      rest.description.includes("횡단보도") &&
      !MERGED_CROSSWALK.test(rest.description) &&
      candidates.some((c) => hasAudioSignalNear(c.lat, c.lng, MATCH_RADIUS_METERS))
        ? { ...rest, description: `${rest.description}, ${ANNOTATION}` }
        : rest;
    // 기하 보존(실시간 길 안내 옵트인): 좌표를 pathCoords 한 형태로 통일해
    // 소비자가 카카오·Tmap 두 모양을 다루지 않게 한다. 기본 경로는 종전대로 전량 제거.
    return keepGeometry && candidates.length > 0
      ? { ...annotated, pathCoords: candidates }
      : annotated;
  });
  return { ...briefing, steps };
}

/**
 * 안전 문장을 전달한다. 산문 소비자에겐 스텝 0번 삽입(기존 문장 개변 금지 — 별도
 * 스텝), 구조화 소비자(`includeGeometry`)에겐 필드로만.
 *
 * ⚠ 기하 응답에 유사 스텝을 넣으면 안 된다: `buildGuideRoute`(웹 route-geometry.ts ·
 * Kit RouteGeometry.swift)가 기하 없는 스텝을 만나면 **경로 전체를 거부**해,
 * 무계단 경로가 없을 때 상세 안내가 통째로 간략으로 조용히 강등된다(spec §1.2).
 */
function withStepFree(
  briefing: WalkRouteBriefing,
  status: StepFreeStatus,
  includeGeometry: boolean,
): WalkRouteBriefing {
  if (status === "applied") return { ...briefing, stepFree: status };
  const notice = STEP_FREE_NOTICE[status];
  const withField = { ...briefing, stepFree: status, stepFreeNotice: notice };
  if (includeGeometry) return withField;
  return { ...withField, steps: [{ description: notice }, ...briefing.steps] };
}

async function fetchPrimaryOrFallback(params: {
  origin: Coord;
  dest: Coord;
  accessible: boolean;
  noStore: boolean;
}): Promise<{ briefing: WalkRouteBriefing | null; via: "kakao" | "tmap" } | null> {
  const { origin, dest, accessible, noStore } = params;
  if (hasKakaoKey()) {
    try {
      return {
        briefing: await getKakaoWalkBriefing({ origin, dest, accessible, noStore }),
        via: "kakao",
      };
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
  /** 스텝 폴리라인 보존(실시간 길 안내 옵트인, 스펙 2026-08-03 §7.2). upstream fetch도 no-store. */
  includeGeometry?: boolean;
}): Promise<WalkRouteBriefing | null> {
  const { origin, dest, accessible = false, includeGeometry = false } = params;
  // 재작성 → 주석 순서가 계약이다. 주석은 재작성된 문장 뒤에 붙어야 하고
  // (", 음향신호기 있음"이 먼저 붙으면 재작성 정규식의 `$` 앵커가 전부 깨진다),
  // 병합 판정도 재작성본을 봐야 한다(MERGED_CROSSWALK 주석 참조).
  const annotate = (b: WalkRouteBriefing) =>
    annotateAudioSignals(rewriteWalkBriefing(b, includeGeometry), includeGeometry);

  if (!accessible) {
    const r = await fetchPrimaryOrFallback({
      origin, dest, accessible: false, noStore: includeGeometry,
    });
    return r?.briefing ? annotate(r.briefing) : null;
  }

  // 계단 회피: 카카오 전용. Tmap 경유(폴백·단독)는 동등 모드가 없어 unavailable.
  const r = await fetchPrimaryOrFallback({
    origin, dest, accessible: true, noStore: includeGeometry,
  });
  if (!r) return null;
  if (r.via === "tmap") {
    return r.briefing
      ? withStepFree(annotate(r.briefing), "unavailable", includeGeometry)
      : null;
  }
  if (r.briefing) {
    // applied fail-closed: ACCESSIBLE 응답에 계단 문구가 남아 있으면 안전 선언 금지.
    const hasStairs = r.briefing.steps.some((s) => s.description.includes("계단"));
    return withStepFree(
      annotate(r.briefing),
      hasStairs ? "no_stepfree_route" : "applied",
      includeGeometry,
    );
  }
  // 무계단 경로 부재(ROUTE_RESULT_NOT_FOUND): 기본 모드 재호출(같은 fetch 캐시 공유).
  const base = await fetchPrimaryOrFallback({
    origin, dest, accessible: false, noStore: includeGeometry,
  });
  if (!base?.briefing) return null;
  return withStepFree(
    annotate(base.briefing),
    base.via === "tmap" ? "unavailable" : "no_stepfree_route",
    includeGeometry,
  );
}
