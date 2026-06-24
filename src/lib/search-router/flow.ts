import type { RouterAnchor } from "./types";

/**
 * 검색 앵커 선택(순수). 지오코딩된 지역 좌표가 있으면 그것을, 없으면 현재 위치를,
 * 둘 다 없으면 null(카카오 정확도순 graceful). 지역 명시가 현재 위치를 누른다 —
 * "암사동…"을 길동에서 검색해도 암사동 기준으로 찾기 위함.
 */
export function pickAnchor(
  geocoded: RouterAnchor | null,
  userCoords: RouterAnchor | null,
): RouterAnchor | null {
  return geocoded ?? userCoords ?? null;
}

/**
 * 장소 0건일 때 웹 폴백(길 B) 여부(순수). Perplexity 키가 있고 결과가 0일 때만.
 */
export function shouldFallbackToWeb(
  placeCount: number,
  hasPerplexity: boolean,
): boolean {
  return placeCount === 0 && hasPerplexity;
}
