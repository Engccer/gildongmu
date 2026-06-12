import { hasNaverLocalKeys } from "../env";
import type { PlaceSearchParams, PlaceSearchResult } from "../types";
import { searchPlacesMock } from "./mock";
import { searchPlacesNaverLocal } from "./naver-local";

/**
 * 장소 검색 진입점 — 키 유무에 따라 provider를 자동 선택한다.
 *
 * - NAVER_LOCAL_CLIENT_ID/SECRET 있음 → 네이버 지역 검색 (실데이터)
 * - 없음 → mock (키 발급 전에도 전체 UI 흐름 개발/테스트 가능)
 *
 * 실데이터 호출이 실패하면 mock으로 폴백하지 않고 에러를 그대로 던진다 —
 * 조용한 폴백은 "실데이터처럼 보이는 가짜"를 만들어 디버깅을 방해하기 때문.
 */
export async function searchPlaces(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  if (hasNaverLocalKeys()) {
    return searchPlacesNaverLocal(params);
  }
  return searchPlacesMock(params);
}
