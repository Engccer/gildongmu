import { hasKakaoKey, hasNaverLocalKeys, hasTourApiKey } from "../env";
import type { PlaceSearchParams, PlaceSearchResult } from "../types";
import { searchPlacesKakaoLocal } from "./kakao-local";
import { searchPlacesMock } from "./mock";
import { searchPlacesNaverLocal } from "./naver-local";
import { searchPlacesTourApi } from "./tour-api";

/**
 * 장소 검색 진입점 — 키 유무와 로케일에 따라 provider를 자동 선택한다.
 *
 * 우선순위:
 * 1. en 로케일 + TourAPI 키 → tour-api (카카오·네이버 모두 다국어 미지원 —
 *    영문 장소명·주소를 주는 유일한 공식 소스이므로 외국인 시나리오 우선)
 * 2. kakao-local > naver-local > mock
 * - 카카오 우선 이유: 결과 최대 15건(네이버 5건), WGS84 좌표 그대로,
 *   place_url(카카오맵 상세) 제공 — 탐색 UX가 명백히 우위 (docs/RESEARCH 참고)
 * - PLACES_PROVIDER 환경변수로 강제 지정 가능 (A/B 비교 실험용):
 *   "kakao" | "naver" | "tour" | "mock"
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
  if (forced === "tour") return searchPlacesTourApi(params);
  if (forced === "mock") return searchPlacesMock(params);

  if (params.lang === "en" && hasTourApiKey()) {
    return searchPlacesTourApi(params);
  }
  if (hasKakaoKey()) {
    return searchPlacesKakaoLocal(params);
  }
  if (hasNaverLocalKeys()) {
    return searchPlacesNaverLocal(params);
  }
  return searchPlacesMock(params);
}

/** 현재 활성화될 provider 이름 — UI 안내용 (ko 로케일 기준 기본 경로) */
export function activeProviderName(): PlaceSearchResult["provider"] {
  const forced = process.env.PLACES_PROVIDER;
  if (forced === "kakao") return "kakao-local";
  if (forced === "naver") return "naver-local";
  if (forced === "tour") return "tour-api";
  if (forced === "mock") return "mock";
  if (hasKakaoKey()) return "kakao-local";
  if (hasNaverLocalKeys()) return "naver-local";
  return "mock";
}
