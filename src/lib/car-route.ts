import { getTmapCarBriefing } from "./providers/tmap-car";
import { getCarRouteBriefing } from "./providers/kakao-navi";
import { hasKakaoKey, hasTmapKey } from "./env";
import { logRouteFallback } from "./route-fallback-log";
import { rewriteCarBriefing } from "./car-guidance";
import type { CarRouteBriefing, Coord } from "./types";

/**
 * 자동차 경로(ko) 서비스 진입점(라우트·채팅 공용 — provider 직접 호출 금지,
 * walk-route.ts 동형). 기본 Tmap, Tmap throw 시에만 카카오모빌리티 폴백
 * (2026-07-30 실호출 대조·위원장 판정 — 도보와 정반대 방향: 자동차는 Tmap
 * description이 도로명 포함 완성 문장, 카카오 guidance는 조각형).
 * en 경로는 NCP 현행 유지라 이 서비스를 타지 않는다.
 *
 * Tmap "경로 없음"류 코드가 아직 미관측이라 모든 실패가 폴백을 탄다 —
 * 관측 시 tmap-car.ts에 graceful 분기를 추가한다(추측 금지).
 */

export async function getCarRoute(params: {
  origin: Coord;
  dest: Coord;
  /** B1 실시간 자동차 안내 옵트인 — Tmap 경로에만 유효(카카오 폴백은 기하 미지원). */
  includeGeometry?: boolean;
  /** 경유지 1개(N4) — Tmap passList·카카오 waypoints 両 provider 수용(실호출 2026-08-22). */
  via?: Coord;
}): Promise<CarRouteBriefing> {
  // 안내문 재작성은 진입점 한 곳이 계약이다(walk-route.ts의 rewriteWalkBriefing
  // 동형) — 모든 소비자(웹·iOS·CLI·채팅·실시간 안내)가 한 번에 동조된다.
  // 카카오 폴백 문장은 재작성 문형(꼬리 "…따라 …m 이동")이 없어 원문 통과.
  if (hasTmapKey()) {
    try {
      // provider 판별자(B1 §3.1): 카카오 폴백 응답은 기하 미지원이라 클라이언트가
      // 이 값으로 자동차 안내 버튼 노출을 게이트한다.
      return rewriteCarBriefing({ ...(await getTmapCarBriefing(params)), provider: "tmap" });
    } catch (e) {
      if (!hasKakaoKey()) throw e;
      logRouteFallback("[car-route] Tmap 실패, 카카오모빌리티 폴백:", params.origin, params.dest, e);
      return rewriteCarBriefing({ ...(await getCarRouteBriefing(params)), provider: "kakao" });
    }
  }
  if (hasKakaoKey()) {
    return rewriteCarBriefing({ ...(await getCarRouteBriefing(params)), provider: "kakao" });
  }
  // 게이트(hasCarRouteKey)가 먼저 막지만 직접 호출 경로 이중 방어
  throw new Error("자동차 경로 브리핑은 API 키 등록 후 사용할 수 있습니다.");
}
