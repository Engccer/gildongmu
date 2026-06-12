import type { RouteEndpoints, RouteMode } from "./types";
import { isInKorea } from "./deeplink";

/**
 * 카카오맵 앱 딥링크(kakaomap:// URL Scheme) 생성.
 *
 * 참고: https://apis.map.kakao.com/web/guide/ (URL Scheme 안내)
 * - kakaomap://look?p={lat},{lng} : 좌표 보기
 * - kakaomap://search?q={query} : 검색
 * - kakaomap://route?sp=...&ep=...&by=CAR|PUBLICTRANSIT|FOOT : 길찾기
 *
 * 네이버 nmap://와 달리 출발지(sp) 생략 시 현재 위치가 기본이다.
 */

const MODE_TO_BY: Record<RouteMode, string> = {
  car: "CAR",
  public: "PUBLICTRANSIT",
  walk: "FOOT",
  // 카카오맵 route by에 자전거는 없음 — 도보로 대체
  bike: "FOOT",
};

export function buildKakaoRouteDeeplink(
  mode: RouteMode,
  endpoints: RouteEndpoints,
): string {
  const { start, dest } = endpoints;
  if (!isInKorea(dest.lat, dest.lng)) {
    throw new Error(
      `목적지 좌표가 한반도 권역을 벗어남: ${dest.lat}, ${dest.lng}`,
    );
  }
  const params = new URLSearchParams();
  if (start) {
    params.set("sp", `${start.lat},${start.lng}`);
  }
  params.set("ep", `${dest.lat},${dest.lng}`);
  params.set("by", MODE_TO_BY[mode]);
  return `kakaomap://route?${params.toString()}`;
}

export function buildKakaoLookDeeplink(place: {
  lat: number;
  lng: number;
}): string {
  return `kakaomap://look?p=${place.lat},${place.lng}`;
}
