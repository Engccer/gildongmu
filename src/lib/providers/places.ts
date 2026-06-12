import { hasKakaoKey, hasNaverLocalKeys } from "../env";
import type { PlaceSearchParams, PlaceSearchResult } from "../types";
import { searchPlacesKakaoLocal } from "./kakao-local";
import { searchPlacesMock } from "./mock";
import { searchPlacesNaverLocal } from "./naver-local";

/**
 * 장소 검색 진입점 — 키 유무에 따라 provider를 자동 선택한다.
 *
 * 우선순위: kakao-local > naver-local > mock
 * - 카카오 우선 이유: 결과 최대 15건(네이버 5건), WGS84 좌표 그대로,
 *   place_url(카카오맵 상세) 제공 — 탐색 UX가 명백히 우위 (docs/RESEARCH 참고)
 * - PLACES_PROVIDER 환경변수로 강제 지정 가능 (A/B 비교 실험용):
 *   "kakao" | "naver" | "mock"
 *
 * 실데이터 호출이 실패하면 mock으로 폴백하지 않고 에러를 그대로 던진다 —
 * 조용한 폴백은 "실데이터처럼 보이는 가짜"를 만들어 디버깅을 방해하기 때문.
 */
export async function searchPlaces(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const forced = process.env.PLACES_PROVIDER;
  if (forced === "kakao") return searchPlacesKakaoLocal(params);
  if (forced === "naver") return searchPlacesNaverLocal(params);
  if (forced === "mock") return searchPlacesMock(params);

  if (hasKakaoKey()) {
    return searchPlacesKakaoLocal(params);
  }
  if (hasNaverLocalKeys()) {
    return searchPlacesNaverLocal(params);
  }
  return searchPlacesMock(params);
}

/** 현재 활성화될 provider 이름 — UI 안내용 */
export function activeProviderName(): "kakao-local" | "naver-local" | "mock" {
  const forced = process.env.PLACES_PROVIDER;
  if (forced === "kakao") return "kakao-local";
  if (forced === "naver") return "naver-local";
  if (forced === "mock") return "mock";
  if (hasKakaoKey()) return "kakao-local";
  if (hasNaverLocalKeys()) return "naver-local";
  return "mock";
}
