import { getKakaoWalkBriefing } from "./providers/kakao-walk";
import { getWalkRouteBriefing } from "./providers/tmap-pedestrian";
import { hasAudioSignalNear } from "./providers/audio-signals";
import { matchCrosswalk } from "./providers/crosswalks";
import { formatDistance } from "./format";
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

/**
 * 최단 경로(variant=shortest)×계단 회피의 곱 전용 경고(M3 spec §3.2).
 * Tmap searchOption=30("최단+계단제외")이 실측상 추천과 동일해 "최단이면서
 * 계단을 피하는 경로"는 어느 API도 제공하지 못한다 — 숨기지 않고 경고 병기.
 */
const SHORTEST_STEPFREE_NOTICE =
  "최단 경로에는 계단 회피가 적용되지 않습니다. 계단이 포함될 수 있습니다.";

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
 * 횡단보도 차로 수·도로 폭 주석(E8, spec 2026-08-23-crosswalk-lanes-length-design.md).
 * 단일 횡단보도 스텝(병합 아님)의 폴리라인으로 전국횡단보도표준데이터 seed를
 * 3중 게이트(위치·길이 타당성·합의)로 판정해 ", N차로, 도로 폭 Mm"를 붙인다.
 * **있는 곳만 말하고 없는 곳은 침묵**(위원장 2026-08-16) — 수식이라 3-state 대상이
 * 아니다. "도로 폭"이라는 이름을 다는 이유: 재작성 문장이 이미 "횡단보도 길이 21m"
 * (보도 간 스텝 거리)를 달고 있어 맨몸 수치를 덧붙이면 길이가 둘로 들린다.
 *
 * 파이프라인의 **마지막** 주석 단계라 기하 제거·통일(종전 annotateAudioSignals 계약)을
 * 여기서 맡는다 — 앞 단계는 keepGeometry=true로 불러 pathCoords를 넘긴다.
 */
export function annotateCrosswalkInfo(
  briefing: WalkRouteBriefing,
  keepGeometry: boolean,
): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { coord, pathCoords, ...rest } = step;
    const candidates = pathCoords ?? (coord ? [coord] : []);
    const info =
      rest.description.includes("횡단보도") && !MERGED_CROSSWALK.test(rest.description)
        ? matchCrosswalk(candidates)
        : null;
    const annotated = info
      ? {
          ...rest,
          description: `${rest.description}, ${info.lanes}차로, 도로 폭 ${formatDistance(Math.round(info.lengthM))}`,
        }
      : rest;
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
  noticeOverride?: string,
): WalkRouteBriefing {
  if (status === "applied") return { ...briefing, stepFree: status };
  const notice = noticeOverride ?? STEP_FREE_NOTICE[status];
  const withField = { ...briefing, stepFree: status, stepFreeNotice: notice };
  if (includeGeometry) return withField;
  // 스텝 0 삽입은 경유지 인덱스(N4 `waypoint.stepIndex`)를 한 칸 민다 — 함께 보정.
  return {
    ...withField,
    steps: [{ description: notice }, ...briefing.steps],
    ...(briefing.waypoint
      ? { waypoint: { ...briefing.waypoint, stepIndex: briefing.waypoint.stepIndex + 1 } }
      : {}),
  };
}

async function fetchPrimaryOrFallback(params: {
  origin: Coord;
  dest: Coord;
  accessible: boolean;
  noStore: boolean;
  /** 경유지 1개(N4) — 両 provider가 받는다(실호출 확정 2026-08-22). */
  waypoint: Coord | undefined;
}): Promise<{ briefing: WalkRouteBriefing | null; via: "kakao" | "tmap" } | null> {
  const { origin, dest, accessible, noStore, waypoint } = params;
  if (hasKakaoKey()) {
    try {
      return {
        briefing: await getKakaoWalkBriefing({ origin, dest, accessible, via: waypoint, noStore }),
        via: "kakao",
      };
    } catch (e) {
      if (!hasTmapKey()) throw e;
      logRouteFallback("[walk-route] 카카오 실패, Tmap 폴백:", origin, dest, e);
      return { briefing: await getWalkRouteBriefing({ origin, dest, via: waypoint }), via: "tmap" };
    }
  }
  if (hasTmapKey()) {
    return { briefing: await getWalkRouteBriefing({ origin, dest, via: waypoint }), via: "tmap" };
  }
  return null; // 게이트(hasWalkRouteKey)가 먼저 막지만 이중 방어
}

export async function getWalkRoute(params: {
  origin: Coord;
  dest: Coord;
  accessible?: boolean;
  /** 스텝 폴리라인 보존(실시간 길 안내 옵트인, 스펙 2026-08-03 §7.2). upstream fetch도 no-store. */
  includeGeometry?: boolean;
  /** 경로 축(M3): 미지정=추천(현행 파이프라인), "shortest"=Tmap searchOption=10 단독. */
  variant?: "shortest";
  /** 경유지 1개(N4). 응답 `waypoint`가 그 도착 지점을 가리킨다. */
  via?: Coord;
}): Promise<WalkRouteBriefing | null> {
  const { origin, dest, accessible = false, includeGeometry = false, variant, via } = params;
  // 재작성 → 주석 순서가 계약이다. 주석은 재작성된 문장 뒤에 붙어야 하고
  // (", 음향신호기 있음"이 먼저 붙으면 재작성 정규식의 `$` 앵커가 전부 깨진다),
  // 병합 판정도 재작성본을 봐야 한다(MERGED_CROSSWALK 주석 참조).
  // 음향신호기 단계는 기하를 보존해 넘기고(keepGeometry=true), 마지막 차로 수 단계가
  // 종전 계약대로 기하를 제거·통일한다. 순서: 음향신호기(안전) → 차로 수(수식).
  const annotate = (b: WalkRouteBriefing) =>
    annotateCrosswalkInfo(
      annotateAudioSignals(rewriteWalkBriefing(b, includeGeometry), true),
      includeGeometry,
    );

  if (variant === "shortest") {
    // 최단은 Tmap 전용 축(카카오에 동등 옵션 없음) — 폴백 없음, 실패는 throw(502).
    // 키 부재도 throw다: null은 "경로 없음"의 의미라 "축 자체가 성립 안 함"을
    // 정상 결과로 위장하게 된다(소비자는 alternatives의 shortest 존재로 이미 게이트됨).
    if (!hasTmapKey()) {
      throw new Error("[walk-route] variant=shortest는 Tmap 키가 필요합니다");
    }
    const briefing = await getWalkRouteBriefing({
      origin,
      dest,
      searchOption: "10",
      via,
      includeLineGeometry: includeGeometry,
      noStore: includeGeometry,
    });
    if (!briefing) return null;
    const annotated = annotate(briefing);
    return accessible
      ? withStepFree(annotated, "unavailable", includeGeometry, SHORTEST_STEPFREE_NOTICE)
      : annotated;
  }

  if (!accessible) {
    const r = await fetchPrimaryOrFallback({
      origin, dest, accessible: false, noStore: includeGeometry, waypoint: via,
    });
    return r?.briefing ? annotate(r.briefing) : null;
  }

  // 계단 회피: 카카오 전용. Tmap 경유(폴백·단독)는 동등 모드가 없어 unavailable.
  const r = await fetchPrimaryOrFallback({
    origin, dest, accessible: true, noStore: includeGeometry, waypoint: via,
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
    origin, dest, accessible: false, noStore: includeGeometry, waypoint: via,
  });
  if (!base?.briefing) return null;
  return withStepFree(
    annotate(base.briefing),
    base.via === "tmap" ? "unavailable" : "no_stepfree_route",
    includeGeometry,
  );
}

/**
 * 추천(기본 파이프라인)+최단(Tmap searchOption=10)을 병렬 조회한다(M3, 조회 화면 전용).
 * 부분 성공은 비대칭이다(spec §3.1 리뷰 #5): 기본 실패는 rethrow(502 계약 유지),
 * 최단 실패만 흡수해 `shortest: null`(현행과 동일한 화면 성립). Tmap 키 부재면
 * 최단 조회 자체를 생략하고 `shortest` 키를 싣지 않는다.
 * 기하는 싣지 않는다(조회 화면 불필요 — 안내 시작 시 variant 단일 조회가 담당).
 */
export async function getWalkRouteAlternatives(params: {
  origin: Coord;
  dest: Coord;
  accessible?: boolean;
  via?: Coord;
}): Promise<{ result: WalkRouteBriefing | null; shortest?: WalkRouteBriefing | null }> {
  const { origin, dest, accessible = false, via } = params;
  if (!hasTmapKey()) {
    return { result: await getWalkRoute({ origin, dest, accessible, via }) };
  }
  const [primary, shortest] = await Promise.allSettled([
    getWalkRoute({ origin, dest, accessible, via }),
    getWalkRoute({ origin, dest, accessible, via, variant: "shortest" }),
  ]);
  if (primary.status === "rejected") throw primary.reason;
  return {
    result: primary.value,
    shortest: shortest.status === "fulfilled" ? shortest.value : null,
  };
}
