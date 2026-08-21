import type { Coord } from "./types";

/**
 * 도보 경로 조회 URL의 단일 조립점(브리핑·실시간 안내 공용).
 *
 * ⚠ **인자를 전부 required로 두는 것이 이 모듈의 존재 이유다.** 백로그 A4는
 * "생략 가능한 안전 인자"가 만든 결함이었다 — 안내 조회가 `accessible`을 빠뜨려도
 * 아무 오류가 나지 않아, 계단 회피를 켠 사용자가 계단으로 안내받았다(spec §2.5).
 *
 * ⚠ 좌표 구분자는 인코딩하지 않은 쉼표다(`URLSearchParams`는 `%2C`로 바꾼다).
 * 기능은 같지만 URL 문자열이 달라져 기존 캐시 키와 테스트 단언이 어긋난다.
 * 옵트인 파라미터는 꺼짐이면 붙이지 않는다 — 기존 캐시 경로 유지.
 */
export function walkRouteUrl(params: {
  origin: Coord;
  dest: Coord;
  accessible: boolean;
  includeGeometry: boolean;
  /** 경유지(N4). null이면 부재 — 같은 이유로 required: 경유지를 빠뜨린 조회는 오류 없이 다른 경로를 준다. */
  via: Coord | null;
}): string {
  const { origin, dest, accessible, includeGeometry, via } = params;
  let url = `/api/route/walk?origin=${origin.lat},${origin.lng}&dest=${dest.lat},${dest.lng}`;
  if (via) url += `&via=${via.lat},${via.lng}`;
  if (accessible) url += "&accessible=true";
  if (includeGeometry) url += "&includeGeometry=1";
  return url;
}
