import type { RouteEndpoints, RouteMode } from "./types";

/**
 * 네이버 지도 앱 딥링크(nmap:// URL Scheme) 생성.
 *
 * 공식 문서: https://guide.ncloud-docs.com/docs/maps-url-scheme
 * - appname 파라미터는 모든 URL에 필수
 * - 좌표 유효 범위: 위도 31.43~44.35, 경도 122.37~132.00 (한반도 권역)
 *
 * NCP Directions API가 자동차 경로만 제공하므로, 도보/대중교통/자전거
 * 내비게이션은 이 딥링크로 네이버 지도 앱에 위임하는 것이 공식 경로다.
 */

const LAT_RANGE = [31.43, 44.35] as const;
const LNG_RANGE = [122.37, 132.0] as const;

export function isInKorea(lat: number, lng: number): boolean {
  return (
    lat >= LAT_RANGE[0] &&
    lat <= LAT_RANGE[1] &&
    lng >= LNG_RANGE[0] &&
    lng <= LNG_RANGE[1]
  );
}

/**
 * 길찾기 딥링크 생성.
 * 출발지를 생략하면 네이버 지도 앱이 현재 위치를 출발지로 사용한다.
 */
export function buildRouteDeeplink(
  mode: RouteMode,
  endpoints: RouteEndpoints,
  appname: string,
): string {
  const { start, dest } = endpoints;
  if (!isInKorea(dest.lat, dest.lng)) {
    throw new Error(
      `목적지 좌표가 한반도 권역을 벗어남: ${dest.lat}, ${dest.lng}`,
    );
  }
  const params = new URLSearchParams();
  if (start) {
    params.set("slat", String(start.lat));
    params.set("slng", String(start.lng));
    params.set("sname", start.name);
  }
  params.set("dlat", String(dest.lat));
  params.set("dlng", String(dest.lng));
  params.set("dname", dest.name);
  params.set("appname", appname);
  return `nmap://route/${mode}?${params.toString()}`;
}

/** 좌표 핀 + 이름으로 지도 앱을 여는 딥링크 */
export function buildPlaceDeeplink(
  place: { lat: number; lng: number; name: string },
  appname: string,
): string {
  const params = new URLSearchParams({
    lat: String(place.lat),
    lng: String(place.lng),
    name: place.name,
    appname,
  });
  return `nmap://place?${params.toString()}`;
}

/**
 * 네이버 지도 앱 미설치 환경(데스크톱, 미설치 모바일)용 웹 폴백 URL.
 * 웹 지도는 딥링크만큼 정밀한 제어가 안 되므로 검색 URL로 위임한다.
 */
export function buildWebFallbackUrl(query: string): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}
