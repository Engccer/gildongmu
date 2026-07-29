import { getTmapCarBriefing } from "./providers/tmap-car";
import { getCarRouteBriefing } from "./providers/kakao-navi";
import { hasKakaoKey, hasTmapKey } from "./env";
import { roundCoord } from "./coord-round";
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

/**
 * 폴백 원인 로그 — Vercel 로그로 폴백률·구간을 관측한다(파서 회귀 조기 발견).
 * 좌표는 4자리 반올림(약 ±5.5m) — 로그 가독성용.
 */
function logFallback(origin: Coord, dest: Coord, reason: unknown) {
  console.warn(
    "[car-route] Tmap 실패, 카카오모빌리티 폴백:",
    roundCoord(origin.lat, 4),
    roundCoord(origin.lng, 4),
    "→",
    roundCoord(dest.lat, 4),
    roundCoord(dest.lng, 4),
    reason,
  );
}

export async function getCarRoute(params: {
  origin: Coord;
  dest: Coord;
}): Promise<CarRouteBriefing> {
  if (hasTmapKey()) {
    try {
      return await getTmapCarBriefing(params);
    } catch (e) {
      if (!hasKakaoKey()) throw e;
      logFallback(params.origin, params.dest, e);
      return getCarRouteBriefing(params);
    }
  }
  if (hasKakaoKey()) return getCarRouteBriefing(params);
  // 게이트(hasCarRouteKey)가 먼저 막지만 직접 호출 경로 이중 방어
  throw new Error("자동차 경로 브리핑은 API 키 등록 후 사용할 수 있습니다.");
}
