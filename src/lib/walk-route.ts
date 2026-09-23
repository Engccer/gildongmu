import { getKakaoWalkBriefing, type KakaoWalkRouteMode } from "./providers/kakao-walk";
import { getWalkRouteBriefing } from "./providers/tmap-pedestrian";
import { hasAudioSignalNear } from "./providers/audio-signals";
import { matchCrosswalk } from "./providers/crosswalks";
import { formatDistance } from "./format";
import { hasKakaoKey, hasTmapKey } from "./env";
import { logRouteFallback } from "./route-fallback-log";
import { rewriteWalkBriefing } from "./walk-guidance";
import { buildEnBriefing, roadNameKeysOf } from "./walk-guidance-en";
import { roadNamesEn } from "./providers/juso-road-name";
import { walkStepAction } from "./walk-action";
import type {
  Coord,
  StepFreeStatus,
  WalkLineKind,
  WalkRouteBriefing,
  WalkRouteLine,
} from "./types";

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

/**
 * 음향신호기 주석 문구. 도보 경로가 ko 전용이던 시절의 상수를 로케일로 갈랐다(E16 축3).
 * 서버가 만드는 데이터 문장이라 i18n 키가 아니라 여기가 정본이다(ko 재작성 문장과 같은 층).
 */
const ANNOTATION: Record<WalkLang, string> = {
  ko: "음향신호기 있음",
  en: "audible pedestrian signal",
};
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
const SHORTEST_STEPFREE_NOTICE: Record<WalkLang, string> = {
  ko: "최단 경로에는 계단 회피가 적용되지 않습니다. 계단이 포함될 수 있습니다.",
  en: "Step-free routing does not apply to the shortest route. It may include stairs.",
};

/**
 * 도보 안내 문장의 언어. `dataLocale` 계약대로 비-ko는 en 한 벌이다(장소·주소 데이터와 동형).
 * ⚠ **기본값을 두지 않는다** — 생략이 한국어로 조용히 복구되면 새 비-ko 호출부 하나가 타입
 * 오류 없이 한국어 안내를 낸다([[no-default-for-safety-parameters]]).
 */
export type WalkLang = "ko" | "en";

/** 계단 회피 미적용 시 전달하는 안전 문장(모든 소비자 결정론 전달). */
const STEP_FREE_NOTICE: Record<WalkLang, Record<Exclude<StepFreeStatus, "applied">, string>> = {
  ko: {
    // ⚠ 이 상태는 두 분기가 공유한다: ACCESSIBLE 응답의 계단 문구 잔존(fail-closed —
    // 반환은 ACCESSIBLE 경로)과 무계단 경로 부재 후 기본 모드 재호출(반환은 일반 경로).
    // 그래서 어느 경로를 반환하는지 단정하지 않는다 — 문장의 역할은 경로 설명이
    // 아니라 계단 경고다(spec §2.6, 종전 "일반 경로를 안내합니다"는 앞 분기에서 거짓).
    no_stepfree_route:
      "계단 없는 경로를 확정하지 못했습니다. 안내 경로에 계단이 포함될 수 있습니다.",
    // 이 분기는 실제로 일반 경로를 반환하므로 종전 문장이 참이다.
    unavailable:
      "계단 회피 경로를 조회하지 못했습니다. 일반 경로를 안내하며 계단이 포함될 수 있습니다.",
  },
  // ⚠ en은 Tmap 단독이라 계단 회피가 항상 unavailable이다. 소비자 UI는 컨트롤 자체를 노출하지
  // 않지만(spec §4.7) 직접 API 소비자에게는 정직한 문장이 필요하다.
  en: {
    no_stepfree_route:
      "A step-free route could not be confirmed. The route may include stairs.",
    unavailable:
      "Step-free routing is unavailable. A standard route is provided and it may include stairs.",
  },
};

export function annotateAudioSignals(
  briefing: WalkRouteBriefing,
  keepGeometry: boolean,
  lang: WalkLang,
): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { coord, pathCoords, ...rest } = step;
    // 판정 후보점: 카카오 폴리라인 전체(재캘리브레이션 2026-07-29 — 첫 점만으로는
    // 진입 전 시작점이 신호기와 멀어 미탐) 또는 Tmap 단일 Point.
    const candidates = pathCoords ?? (coord ? [coord] : []);
    // 건널목 판정: **구조화 행동이 있으면 그것을**, 없으면 종전 한국어 문자열을 본다(E16 축3).
    // Tmap 스텝은 normalize 시점에 이미 action을 달고 오므로 en 문장에서도 판정이 성립한다.
    // ko+Tmap에서 211·212·213은 종전 문자열 판정과 같은 결론이라 회귀가 없고, 카카오 스텝은
    // action이 없어 종전 경로 그대로다(병합 표현 게이트 포함).
    // ⚠ **병합 게이트는 두 경로 공통이다**(리뷰 검출): 구조화 분기에서 빼면 여러 횡단보도를
    // 묶은 스텝에 seed 1개 매칭으로 주석이 붙어 "침묵보다 나쁜 거짓 안전 정보"가 된다.
    const isCrosswalk =
      (rest.action !== undefined
        ? rest.action === "crosswalk"
        : rest.description.includes("횡단보도")) && !MERGED_CROSSWALK.test(rest.description);
    const annotated =
      candidates.length > 0 &&
      isCrosswalk &&
      candidates.some((c) => hasAudioSignalNear(c.lat, c.lng, MATCH_RADIUS_METERS))
        ? { ...rest, description: `${rest.description}, ${ANNOTATION[lang]}` }
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
 *
 * ⚠ `provider`가 카카오일 때만 판정한다(기본값 없음 — 안전 인자). 매칭 규칙의
 * 길이 축은 "카카오 횡단보도 스텝 = 보도에서 보도까지의 직선"을 전제로 실측했는데,
 * Tmap 기하 요청(`includeLineGeometry`)의 횡단보도 Point 스텝은 **다음 결정 지점까지
 * 이어지는 LineString**을 pathCoords로 달아 2점 이상이 된다 — 그 구간 길이는 횡단
 * 길이가 아니라 길이 축이 우연히 통과할 수 있다(리뷰 검출 2026-08-23).
 */
export function annotateCrosswalkInfo(
  briefing: WalkRouteBriefing,
  keepGeometry: boolean,
  provider: "kakao" | "tmap",
): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { coord, pathCoords, ...rest } = step;
    const candidates = pathCoords ?? (coord ? [coord] : []);
    const info =
      provider === "kakao" &&
      rest.description.includes("횡단보도") &&
      !MERGED_CROSSWALK.test(rest.description)
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
 * 도보 스텝의 결정 지점 행동을 **서버가 전량 투영**한다(E16 축3 spec §4.2.1).
 * Tmap 스텝은 provider가 `turnType` 표에서 이미 달았고, 카카오 스텝은 **주석까지 끝난 최종
 * 문장**을 종전 클라이언트와 같은 함수(`walkStepAction`)에 태운다 — 같은 입력·같은 함수라
 * 결론이 같다(그래서 리듀서를 `actionSource: "step"`으로 바꿔도 ko 발화가 불변이다).
 *
 * ⚠ 클라이언트 폴백(`step.action ?? walkStepAction(...)`)을 두지 않는 이유: 구조화 판정의
 * **의도된 "행동 없음"**(육교·계단·엘리베이터)과 **미투영**을 구별하지 못한다.
 *
 * ⚠ `includeGeometry`가 아니면 내부 전달 필드를 전부 뗀다 — 브리핑 응답이 byte-identical
 * 이어야 CLI·채팅·MCP가 무변경이다(`live` 조각과 같은 게이트).
 */
export function attachStepActions(
  briefing: WalkRouteBriefing,
  includeGeometry: boolean,
): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { turnType, roadNameKo: _roadNameKo, ...rest } = step;
    if (!includeGeometry) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { action: _action, crossing: _crossing, ...plain } = rest;
      return plain;
    }
    // ⚠ **`turnType`을 가진 스텝(=Tmap 유래)은 문장 폴백을 타지 않는다.** 그 스텝은 이미 표로
    // 분류가 끝났고, `action`이 없다는 것은 "미투영"이 아니라 **의도된 행동 없음**(직진·출발·
    // 육교·계단·엘리베이터)이다. 폴백을 태우면 ko+Tmap의 직진 스텝 교차로명에 "횡단보도"가
    // 섞였을 때 직진 지점에서 crosswalk 톤이 난다(리뷰 검출, `pedestrian-guard`가 문서화한
    // precedence 함정의 반대 방향). 문장 분류는 카카오 스텝(turnType 부재)에만 남는다.
    const action =
      rest.action ??
      (turnType === undefined ? (walkStepAction(rest.description) ?? undefined) : undefined);
    // 횡단 구간 플래그(A26): Tmap 스텝은 `turnType` 표의 행동이 곧 구조화 판정이라 여기서
    // 표시한다(카카오 스텝은 재작성 단계가 이미 표시했고 문장 분류로는 만들지 않는다 —
    // 지명 "횡단보도"가 crosswalk로 분류되는 그 함정이 이 플래그가 존재하는 이유다).
    const crossing =
      rest.crossing ??
      (turnType !== undefined && (action === "crosswalk" || action === "underpass")
        ? (true as const)
        : undefined);
    return {
      ...rest,
      ...(action ? { action } : {}),
      ...(crossing ? { crossing } : {}),
    };
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
  lang: WalkLang,
  noticeOverride?: string,
): WalkRouteBriefing {
  if (status === "applied") return { ...briefing, stepFree: status };
  const notice = noticeOverride ?? STEP_FREE_NOTICE[lang][status];
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
  /**
   * 카카오 탐색 옵션(E42). Tmap 폴백은 `SHORTEST`일 때만 `searchOption=10`(최단)을 싣고,
   * 나머지는 종전대로 미전송(추천) — Tmap에는 계단 회피·큰길 축이 없다(조사 §3).
   */
  routeMode: KakaoWalkRouteMode;
  /** 카카오에 원좌표를 보낸다(E42 줄 목록 — 두 줄 거리 비교의 전제). `ACCESSIBLE`은 늘 원좌표. */
  preciseCoords: boolean;
  noStore: boolean;
  /** 경유지 1개(N4) — 両 provider가 받는다(실호출 확정 2026-08-22). */
  waypoint: Coord | undefined;
  lang: WalkLang;
  /** ⚠ 종전엔 Tmap 폴백에 이 값을 넘기지 않아 기하가 유실됐다(spec §4.6). */
  includeGeometry: boolean;
}): Promise<{ briefing: WalkRouteBriefing | null; via: "kakao" | "tmap" } | null> {
  const { origin, dest, routeMode, preciseCoords, noStore, waypoint, lang, includeGeometry } = params;
  const tmapCall = () =>
    getWalkRouteBriefing({
      origin,
      dest,
      ...(routeMode === "SHORTEST" ? { searchOption: "10" as const } : {}),
      via: waypoint,
      noStore,
      includeLineGeometry: includeGeometry,
      guard: lang === "en",
    });
  // ⚠ en은 폴백이 없다 — 카카오로 내려가면 "가용성 폴백"이 아니라 한국어 문장이 나온다.
  // 회전 코드를 주는 provider가 Tmap뿐이라 언어 자체가 provider 선택을 정한다.
  if (lang === "en") {
    if (!hasTmapKey()) return null; // 게이트(hasWalkRouteKeyFor)가 먼저 막지만 이중 방어
    return { briefing: await tmapCall(), via: "tmap" };
  }
  if (hasKakaoKey()) {
    try {
      return {
        briefing: await getKakaoWalkBriefing({
          origin, dest, routeMode, preciseCoords, via: waypoint, noStore,
        }),
        via: "kakao",
      };
    } catch (e) {
      if (!hasTmapKey()) throw e;
      logRouteFallback("[walk-route] 카카오 실패, Tmap 폴백:", origin, dest, e);
      return { briefing: await tmapCall(), via: "tmap" };
    }
  }
  if (hasTmapKey()) {
    return { briefing: await tmapCall(), via: "tmap" };
  }
  return null; // 게이트(hasWalkRouteKey)가 먼저 막지만 이중 방어
}

/**
 * 최단 축이 성립하는 키 상태인가(E42). ko는 카카오 `SHORTEST`(폴백 Tmap `10`)라 둘 중 하나,
 * en은 Tmap `10` 단독이라 Tmap 키. 종전엔 "Tmap 키 = 최단 축"이었다.
 */
function hasShortestAxis(lang: WalkLang): boolean {
  return lang === "en" ? hasTmapKey() : hasKakaoKey() || hasTmapKey();
}

/**
 * 재작성 → 주석 → 행동 투영(모든 도보 응답이 지나는 한 파이프라인).
 * 재작성 → 주석 순서가 계약이다. 주석은 재작성된 문장 뒤에 붙어야 하고
 * (", 음향신호기 있음"이 먼저 붙으면 재작성 정규식의 `$` 앵커가 전부 깨진다),
 * 병합 판정도 재작성본을 봐야 한다(MERGED_CROSSWALK 주석 참조).
 * 음향신호기 단계는 기하를 보존해 넘기고(keepGeometry=true), 마지막 차로 수 단계가
 * 종전 계약대로 기하를 제거·통일한다. 순서: 음향신호기(안전) → 차로 수(수식) → 행동 투영.
 * ⚠ en은 ko 재작성 파이프라인을 타지 않는다 — 구조화 필드에서 문장을 **새로 만든다**.
 */
async function annotateBriefing(
  b: WalkRouteBriefing,
  provider: "kakao" | "tmap",
  lang: WalkLang,
  includeGeometry: boolean,
): Promise<WalkRouteBriefing> {
  const base =
    lang === "en"
      ? buildEnBriefing(b, await roadNamesEn(roadNameKeysOf(b)))
      : rewriteWalkBriefing(b, includeGeometry);
  return attachStepActions(
    annotateCrosswalkInfo(annotateAudioSignals(base, true, lang), includeGeometry, provider),
    includeGeometry,
  );
}

/**
 * 계단 회피 성립 판정(fail-closed): 카카오 `ACCESSIBLE` 원문에 "계단"이 남아 있으면 안전을
 * 선언하지 않는다. ⚠ 카카오 원문(ko)에만 성립한다 — 재작성·주석 전에 본다.
 */
function mentionsStairs(b: WalkRouteBriefing): boolean {
  return b.steps.some((s) => s.description.includes("계단"));
}

/** `getWalkRoute` 인자(내부 `resolveWalkRoute` 공용). */
interface WalkRouteParams {
  origin: Coord;
  dest: Coord;
  /**
   * 안내 문장의 언어. **기본값 없는 필수 인자**다 — 생략이 한국어로 조용히 복구되면
   * 새 비-ko 호출부 하나가 타입 오류 없이 한국어 안내를 낸다.
   */
  lang: WalkLang;
  accessible?: boolean;
  /** 스텝 폴리라인 보존(실시간 길 안내 옵트인, 스펙 2026-08-03 §7.2). upstream fetch도 no-store. */
  includeGeometry?: boolean;
  /**
   * 경로 축: 미지정=기본 파이프라인(ko 카카오 `BROAD_FIRST`), "shortest"=최단(E42: ko 카카오
   * `SHORTEST`·폴백 Tmap `10`, en Tmap `10`).
   */
  variant?: "shortest";
  /** 경유지 1개(N4). 응답 `waypoint`가 그 도착 지점을 가리킨다. */
  via?: Coord;
}

/** 경로 + 그것을 준 provider + 그 경로의 줄 종류(E42). 종류를 확정할 수 없으면 `kind` 부재. */
interface ResolvedWalkRoute {
  briefing: WalkRouteBriefing;
  provider: "kakao" | "tmap";
  kind?: WalkLineKind;
}

/**
 * 기본 파이프라인·최단·계단 회피 한 벌(종전 `getWalkRoute` 본문) + provider·줄 종류 투영.
 * 줄 종류는 **실제로 돌려준 경로의 성질**이다(요청이 아니라): 계단 회피 요청이 큰길로 내려가면
 * `broad`, Tmap이 준 기본 경로는 `recommended`. 계단 문구가 남은 `ACCESSIBLE` 응답(fail-closed)은
 * 어느 이름도 참이 아니라 `kind`를 싣지 않는다 — 소비자는 요청한 줄 이름 + 경고 문장으로 말한다.
 */
async function resolveWalkRoute(
  params: WalkRouteParams & { preciseCoords: boolean },
): Promise<ResolvedWalkRoute | null> {
  const {
    origin, dest, lang, accessible = false, includeGeometry = false, variant, via, preciseCoords,
  } = params;
  const annotate = (b: WalkRouteBriefing, provider: "kakao" | "tmap") =>
    annotateBriefing(b, provider, lang, includeGeometry);
  const fetchMode = (routeMode: KakaoWalkRouteMode) =>
    fetchPrimaryOrFallback({
      origin, dest, routeMode, preciseCoords, noStore: includeGeometry, waypoint: via, lang, includeGeometry,
    });
  /** 기본 파이프라인이 준 경로의 이름: 카카오 `BROAD_FIRST`는 큰길, Tmap(ko 폴백·en)은 추천. */
  const plainKind = (provider: "kakao" | "tmap"): WalkLineKind =>
    provider === "kakao" ? "broad" : "recommended";

  if (variant === "shortest") {
    // 최단 축(E42): ko는 카카오 `SHORTEST`(카카오 throw 시 Tmap `10` 폴백), en은 Tmap `10`.
    // 키 부재는 throw다: null은 "경로 없음"의 의미라 "축 자체가 성립 안 함"을 정상 결과로
    // 위장하게 된다(소비자는 줄 목록·`alternatives`의 shortest 존재로 이미 게이트됨).
    if (!hasShortestAxis(lang)) {
      throw new Error("[walk-route] variant=shortest를 조회할 키가 없습니다");
    }
    const r = await fetchMode("SHORTEST");
    if (!r?.briefing) return null;
    const annotated = await annotate(r.briefing, r.via);
    return {
      // 옛 앱의 계단 회피 토글 켬 상태(M3 §3.2) — 새 클라이언트는 이 조합을 보내지 않는다.
      briefing: accessible
        ? withStepFree(annotated, "unavailable", includeGeometry, lang, SHORTEST_STEPFREE_NOTICE[lang])
        : annotated,
      provider: r.via,
      kind: "shortest",
    };
  }

  if (!accessible) {
    const r = await fetchMode("BROAD_FIRST");
    return r?.briefing
      ? { briefing: await annotate(r.briefing, r.via), provider: r.via, kind: plainKind(r.via) }
      : null;
  }

  // 계단 회피: 카카오 전용. Tmap 경유(폴백·단독·en)는 동등 모드가 없어 unavailable.
  const r = await fetchMode("ACCESSIBLE");
  if (!r) return null;
  if (r.via === "tmap") {
    return r.briefing
      ? {
          briefing: withStepFree(await annotate(r.briefing, "tmap"), "unavailable", includeGeometry, lang),
          provider: "tmap",
          kind: "recommended",
        }
      : null;
  }
  if (r.briefing) {
    // applied fail-closed: ACCESSIBLE 응답에 계단 문구가 남아 있으면 안전 선언 금지.
    // ⚠ 이 판정은 카카오 원문(ko)에만 성립한다 — en은 위 tmap 분기에서 이미 갈렸다.
    const applied = !mentionsStairs(r.briefing);
    return {
      briefing: withStepFree(
        await annotate(r.briefing, "kakao"),
        applied ? "applied" : "no_stepfree_route",
        includeGeometry,
        lang,
      ),
      provider: "kakao",
      ...(applied ? { kind: "accessible" as const } : {}),
    };
  }
  // 무계단 경로 부재(ROUTE_RESULT_NOT_FOUND): 기본 모드 재호출(같은 fetch 캐시 공유).
  const base = await fetchMode("BROAD_FIRST");
  if (!base?.briefing) return null;
  return {
    briefing: withStepFree(
      await annotate(base.briefing, base.via),
      base.via === "tmap" ? "unavailable" : "no_stepfree_route",
      includeGeometry,
      lang,
    ),
    provider: base.via,
    kind: plainKind(base.via),
  };
}

export async function getWalkRoute(params: WalkRouteParams): Promise<WalkRouteBriefing | null> {
  const r = await resolveWalkRoute({ ...params, preciseCoords: false });
  if (!r) return null;
  // 줄 종류(E42)는 **기하 응답(실시간 안내)에만** 싣는다 — 안내 세션이 전환·프리뷰 이름을 요청값이
  // 아니라 받은 경로에서 얻는다. 브리핑 응답은 byte-identical(CLI·채팅·MCP·옛 앱 무변경,
  // `attachStepActions`의 내부 필드 게이트와 같은 규율).
  return params.includeGeometry && r.kind ? { ...r.briefing, kind: r.kind } : r.briefing;
}

/**
 * 추천(기본 파이프라인)+최단을 병렬 조회한다(M3, **옛 조회 화면 호환 전용** — 배포된 iOS 1.x·
 * 안드로이드가 `alternatives=1`로 부른다. 새 화면은 `getWalkRouteLines`).
 * E42부터 최단의 출처가 ko 카카오 `SHORTEST`라 옛 앱의 "최단이 더 긴" 줄이 구조적으로 사라진다.
 * 부분 성공은 비대칭이다(spec §3.1 리뷰 #5): 기본 실패는 rethrow(502 계약 유지),
 * 최단 실패만 흡수해 `shortest: null`(현행과 동일한 화면 성립). 최단 축이 성립하지 않는
 * 키 상태면 최단 조회 자체를 생략하고 `shortest` 키를 싣지 않는다.
 * 기하는 싣지 않는다(조회 화면 불필요 — 안내 시작 시 variant 단일 조회가 담당).
 */
export async function getWalkRouteAlternatives(params: {
  origin: Coord;
  dest: Coord;
  lang: WalkLang;
  accessible?: boolean;
  via?: Coord;
}): Promise<{ result: WalkRouteBriefing | null; shortest?: WalkRouteBriefing | null }> {
  const { origin, dest, lang, accessible = false, via } = params;
  if (!hasShortestAxis(lang)) {
    return { result: await getWalkRoute({ origin, dest, lang, accessible, via }) };
  }
  // ⚠ en에서 추천·최단이 각각 `roadNamesEn`을 돈다(도로명 캐시 미스가 겹칠 수 있다).
  // 합치지 않는 이유: 두 조회가 **병렬**이라 벽시계는 한 벌과 같고(1.5초 상한도 각자),
  // 도로명은 30일 캐시라 두 번째 호출부터는 미스 자체가 없다. 합치려면 두 브리핑을 먼저
  // 받아야 해서 병렬성이 깨진다 — 지연을 줄이려다 늘리는 교환이다.
  const [primary, shortest] = await Promise.allSettled([
    resolveWalkRoute({ origin, dest, lang, accessible, via, preciseCoords: false }),
    resolveWalkRoute({ origin, dest, lang, accessible, via, variant: "shortest", preciseCoords: false }),
  ]);
  if (primary.status === "rejected") throw primary.reason;
  // provider 혼합 금지(E42 설계 리뷰 MAJOR 2): 추천이 카카오인데 최단만 Tmap 폴백이면 두 provider의
  // 거리를 나란히 놓게 된다 — 조사 §4의 "최단이 더 긴" 역전이 그대로 돌아온다. 최단 실패로 흡수한다.
  const mixed = primary.value?.provider === "kakao" &&
    shortest.status === "fulfilled" && shortest.value?.provider === "tmap";
  return {
    result: primary.value?.briefing ?? null,
    shortest: shortest.status === "fulfilled" && !mixed ? (shortest.value?.briefing ?? null) : null,
  };
}

/** 둘째 줄 조회의 총 예산 — 계단 회피 부재 시 큰길 재조회가 이어져도 첫 줄을 잃지 않게(15초 클라이언트 예산 안). */
const SECOND_LINE_BUDGET_MS = 10_000;

/**
 * 조회 화면의 도보 줄 목록(E42, spec 2026-09-23-walk-two-lines-kakao-design.md). 배열 순서가 화면
 * 순서이고 첫 원소가 기본 펼침이다.
 *
 * - ko: `[shortest, accessible|broad]` — 둘째 줄은 **카카오만**이다. `ACCESSIBLE` 응답이 있고
 *   원문에 계단 문구가 없을 때만 "계단 회피 경로"(`accessible`), 아니면 `BROAD_FIRST`("큰길 경로",
 *   `broad`). 줄 이름이 곧 성질의 약속이라 이름이 거짓이 되는 쪽으로 가지 않는다. 카카오 장애·키
 *   부재면 둘째 줄은 없다 — Tmap에는 계단 회피·큰길 축이 없어 대신할 이름이 없다.
 * - en: `[recommended, shortest]` — 현행 Tmap `0`+`10`(카카오 안내문이 한국어 고정).
 *
 * 3-state: 첫 줄 조회의 throw는 전체 throw(502, 종전 "기본 실패는 502" 비대칭), 둘째 줄의
 * throw는 흡수해 그 줄만 뺀다. 경로 없음(null)은 그 줄만 뺀다 — 둘 다 없으면 `[]`("경로 없음").
 * ⚠ 줄 경로에는 `stepFree`·`stepFreeNotice`·스텝 0 유사 문장이 없다 — 이름(`kind`)이 그 정보다.
 * 기하는 싣지 않는다(조회 화면 전용 — 안내 시작은 줄 종류의 단일 조회가 담당).
 */
export async function getWalkRouteLines(params: {
  origin: Coord;
  dest: Coord;
  lang: WalkLang;
  via?: Coord;
}): Promise<WalkRouteLine[]> {
  const { origin, dest, lang, via } = params;
  const line = (r: ResolvedWalkRoute | null, kind: WalkLineKind): WalkRouteLine | null =>
    r ? { kind, route: r.briefing } : null;
  // 한 응답의 줄들은 **같은 좌표**로 부른다(원좌표) — 반올림은 upstream 좌표를 바꿔 같은 길이
  // "최단"이 더 긴 두 줄을 만든다(설계 리뷰 MAJOR 2).
  const firstLine = () =>
    resolveWalkRoute({
      origin, dest, lang, via, preciseCoords: true, ...(lang === "en" ? {} : { variant: "shortest" as const }),
    });
  const secondLine = async (): Promise<WalkRouteLine | null> => {
    if (lang === "en") {
      if (!hasShortestAxis(lang)) return null;
      return line(
        await resolveWalkRoute({ origin, dest, lang, via, variant: "shortest", preciseCoords: true }),
        "shortest",
      );
    }
    if (!hasKakaoKey()) return null;
    // 카카오 직접 호출(폴백 없음) — 둘째 줄의 이름은 카카오 탐색 옵션이 보장하는 성질이다.
    const kakao = (routeMode: KakaoWalkRouteMode) =>
      getKakaoWalkBriefing({ origin, dest, routeMode, preciseCoords: true, via, noStore: false });
    const accessible = await kakao("ACCESSIBLE");
    if (accessible && !mentionsStairs(accessible)) {
      return { kind: "accessible", route: await annotateBriefing(accessible, "kakao", lang, false) };
    }
    const broad = await kakao("BROAD_FIRST");
    return broad
      ? { kind: "broad", route: await annotateBriefing(broad, "kakao", lang, false) }
      : null;
  };
  const budgeted = <T>(p: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("[walk-route] 둘째 줄 예산 초과")), SECOND_LINE_BUDGET_MS);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  };
  const [first, second] = await Promise.allSettled([firstLine(), budgeted(secondLine())]);
  if (first.status === "rejected") throw first.reason;
  if (second.status === "rejected") {
    logRouteFallback("[walk-route] 둘째 줄 조회 실패, 첫 줄만:", origin, dest, second.reason);
  }
  const firstKind: WalkLineKind = lang === "en" ? (first.value?.kind ?? "recommended") : "shortest";
  const lines = [
    line(first.value, firstKind),
    // provider 혼합 금지(설계 리뷰 MAJOR 2): ko 첫 줄이 Tmap 폴백이면 카카오 둘째 줄을 싣지 않는다.
    second.status === "fulfilled" && !(lang === "ko" && first.value?.provider === "tmap")
      ? second.value
      : null,
  ].filter((l): l is WalkRouteLine => l !== null);
  // 3-state: 싣는 줄이 0개인데 실패가 섞였으면 "경로 없음"이 아니라 조회 실패다(502).
  if (lines.length === 0 && second.status === "rejected") throw second.reason;
  return lines;
}
