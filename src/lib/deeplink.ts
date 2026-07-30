import type { RouteEndpoints, RouteMode } from "./types";
import { isInKorea } from "./coverage";

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

export { isInKorea };

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

/**
 * 모바일 UA 판별 — 네이버 "열기" 버튼의 경로 분기(모바일=앱 스킴 시도, 데스크톱=웹 지도).
 * iPadOS 13+ 사파리는 Macintosh로 위장하지만, 위장 UA에서 nmap:// 실패 시에도
 * 아래 폴백 타이머가 웹 지도로 회복하므로 오판의 실해가 없다(과잉 판별 금지).
 */
export function isMobileUserAgent(ua: string): boolean {
  return /iPhone|iPad|iPod|Android/i.test(ua);
}
