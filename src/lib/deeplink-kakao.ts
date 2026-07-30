import type { RouteEndpoints, RouteMode } from "./types";
import { isInKorea } from "./deeplink";

/**
 * 카카오맵 앱 딥링크(kakaomap:// URL Scheme) + 웹 URL 생성.
 *
 * 공식 문서:
 * - 앱 스킴: https://apis.map.kakao.com/ios_v2/docs/getting-started/urlscheme/
 * - 웹 URL: https://apis.map.kakao.com/web/guide/ (URL로 카카오맵 연결)
 *
 * 카카오맵 딥링크는 도보(foot)·대중교통(publictransit)·자전거(bicycle)
 * 모드가 공식 문서화된 유일한 국내 지도 앱 스킴이다 (네이버/카카오 모두
 * 도보·대중교통 경로 REST API는 미제공 — docs/RESEARCH 참고).
 *
 * 웹앱에서는 kakaomap:// 직접 호출(실패 감지 어려움)보다
 * map.kakao.com/link/* URL이 안전 — 모바일은 앱으로, 미설치/데스크톱은
 * 웹 지도로 자연 폴백된다.
 */

/** kakaomap://route 의 by 파라미터 (공식: car, publictransit, foot, bicycle) */
const MODE_TO_BY: Record<RouteMode, string> = {
  car: "car",
  public: "publictransit",
  walk: "foot",
  bike: "bicycle",
};

/** map.kakao.com/link/by/{수단} 경로 세그먼트 */
const MODE_TO_WEB_BY: Record<RouteMode, string> = {
  car: "car",
  public: "traffic",
  walk: "walk",
  bike: "bicycle",
};

function assertDestInKorea(dest: { lat: number; lng: number }): void {
  if (!isInKorea(dest.lat, dest.lng)) {
    throw new Error(
      `목적지 좌표가 한반도 권역을 벗어남: ${dest.lat}, ${dest.lng}`,
    );
  }
}

/**
 * 길찾기 앱 딥링크. 출발지(sp) 생략 시 현재 위치 출발.
 * ⚠ 웹 미사용·iOS GildongmuKit Deeplink.swift 미러의 원본 — 죽은 코드 아님(제거 금지).
 */
export function buildKakaoRouteDeeplink(
  mode: RouteMode,
  endpoints: RouteEndpoints,
): string {
  const { start, dest } = endpoints;
  assertDestInKorea(dest);
  const params = new URLSearchParams();
  if (start) {
    params.set("sp", `${start.lat},${start.lng}`);
  }
  params.set("ep", `${dest.lat},${dest.lng}`);
  params.set("by", MODE_TO_BY[mode]);
  return `kakaomap://route?${params.toString()}`;
}

/**
 * 장소 상세 앱 딥링크 — 카카오 로컬 API의 장소 id와 직접 연결되는
 * 공식 체인 (Place.id의 "kakao-" 프리픽스는 제거하고 전달할 것).
 * ⚠ 웹 미사용·iOS GildongmuKit Deeplink.swift 미러의 원본 — 죽은 코드 아님(제거 금지).
 */
export function buildKakaoPlaceDeeplink(kakaoPlaceId: string): string {
  return `kakaomap://place?id=${encodeURIComponent(kakaoPlaceId)}`;
}

/**
 * 길찾기 웹 URL — 미설치/데스크톱 폴백 겸용.
 * 형식: https://map.kakao.com/link/by/{수단}/{이름},{위도},{경도}
 * (출발지 지정이 필요하면 /link/from/.../to/... 형식이 따로 있으나
 *  현재 위치 출발이 기본 시나리오라 도착지 단일 형식만 제공)
 */
export function buildKakaoWebRouteUrl(
  mode: RouteMode,
  dest: { lat: number; lng: number; name: string },
): string {
  assertDestInKorea(dest);
  return `https://map.kakao.com/link/by/${MODE_TO_WEB_BY[mode]}/${encodeURIComponent(dest.name)},${dest.lat},${dest.lng}`;
}

/** 지도 보기 웹 URL */
export function buildKakaoWebMapUrl(place: {
  lat: number;
  lng: number;
  name: string;
}): string {
  return `https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
}
