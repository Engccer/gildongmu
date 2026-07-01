import { hasKakaoKey, hasTourApiKey } from "../env";
import type { PlaceSearchParams, PlaceSearchResult } from "../types";
import { searchAttractionsKakao } from "./kakao-attractions";
import { searchAttractionsTourApi } from "./tour-api";

/**
 * 관광지·명소 검색 진입점 — 로케일로 소스를 분기한다(`searchPlaces`와 동형).
 *
 * - ko: 카카오 로컬 정확도순 + category_name "여행 > 관광,명소" 필터(한글명).
 * - en: TourAPI EngService2 + contentTypeId=76(영문명). 카카오 명소는 한글
 *   이름만 줘 외국인이 못 읽으므로 en은 TourAPI 단독으로 채운다(병합 안 함).
 *
 * en 소스 키(TourAPI)가 없으면 카카오로 graceful degrade — 한글명이라도
 * 노출하는 편이 명소 섹션 완전 소실보다 낫다. ⚠ 각 소스 키를 개별 확인한다
 * (`KAKAO_REST_API_KEY`·`TOUR_API_KEY`는 독립 env). 폴백 카카오 경로도
 * `hasKakaoKey()`가 없으면 `KakaoAK undefined`로 401→throw를 던지므로,
 * 키 없으면 빈 결과(死기능 0 — throw 아님)로 막는다.
 */
export async function searchAttractions(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  if (params.lang === "en" && hasTourApiKey()) {
    return searchAttractionsTourApi(params);
  }
  if (hasKakaoKey()) {
    return searchAttractionsKakao(params);
  }
  return { places: [], provider: "none", query: params.query };
}
