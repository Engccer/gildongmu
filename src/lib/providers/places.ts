import {
  hasKakaoKey,
  hasNaverLocalKeys,
  hasNcpMapsKeys,
  hasTourApiKey,
} from "../env";
import type { Place, PlaceSearchParams, PlaceSearchResult } from "../types";
import { searchPlacesKakaoLocal } from "./kakao-local";
import { searchPlacesMock } from "./mock";
import { searchPlacesNaverLocal } from "./naver-local";
import { geocodeEnglishAddress } from "./ncp-geocode";
import { searchPlacesTourApi } from "./tour-api";

/** 좌표 중복 판정 키 — 4자리(약 11m)면 같은 건물/장소로 본다. */
function coordKey(p: Place): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
}

/**
 * en 병합용 중복 제거. primary(카카오) 전부를 우선 담고, secondary(TourAPI)
 * 중 좌표가 겹치지 않는 것만 이어 붙인다. 카카오·TourAPI는 같은 장소를
 * 한글/영문 이름과 미세하게 다른 좌표로 주므로 좌표를 유일 공통축으로 쓴다.
 */
export function mergePlaces(primary: Place[], secondary: Place[]): Place[] {
  const seen = new Set<string>();
  const merged: Place[] = [];
  for (const p of [...primary, ...secondary]) {
    const key = coordKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }
  return merged;
}

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

  if (params.lang === "en" && hasTourApiKey() && hasKakaoKey()) {
    return searchPlacesMergedEn(params);
  }
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

/**
 * en 로케일 병합 검색 — 카카오(일상 장소 커버)를 기본으로, TourAPI(관광
 * 콘텐츠 영문 정보)를 보강해 함께 보여준다. 외국인이 영문 UI에서 학교·카페
 * 같은 일상 장소를 검색해도 0건이 되지 않도록 한 결정 (2026-06-13).
 *
 * 두 소스를 병렬 호출하고 한쪽이 실패해도 다른 쪽 실데이터는 보존한다.
 * 다만 둘 다 실패하면 조용히 빈 결과를 주지 않고 에러를 던진다 —
 * "실데이터처럼 보이는 빈 결과"로 장애를 가리지 않기 위해서.
 */
export async function searchPlacesMergedEn(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const [kakaoR, tourR] = await Promise.allSettled([
    searchPlacesKakaoLocal(params),
    searchPlacesTourApi(params),
  ]);

  if (kakaoR.status === "rejected" && tourR.status === "rejected") {
    throw kakaoR.reason;
  }
  if (kakaoR.status === "rejected") {
    console.error("[places] en 병합 — 카카오 실패:", kakaoR.reason);
  }
  if (tourR.status === "rejected") {
    console.error("[places] en 병합 — TourAPI 실패:", tourR.reason);
  }

  const kakao = kakaoR.status === "fulfilled" ? kakaoR.value.places : [];
  const tour = tourR.status === "fulfilled" ? tourR.value.places : [];
  const merged = mergePlaces(kakao, tour);
  return {
    places: hasNcpMapsKeys() ? await enrichEnglishAddresses(merged) : merged,
    provider: "merged",
    query: params.query,
  };
}

/**
 * 카카오 출신 카드(한글 주소)에만 NCP geocoding으로 영문 주소를 보강한다.
 * TourAPI 카드는 이미 영문 주소(addr1)를 가지므로 변환하지 않는다.
 * geocodeEnglishAddress는 실패 시 throw 대신 null을 주므로(영문 주소는
 * best-effort 보강), 변환 못 한 카드는 영문 주소 없이 한글만 남는다.
 */
export async function enrichEnglishAddresses(
  places: Place[],
): Promise<Place[]> {
  return Promise.all(
    places.map(async (p) => {
      if (!p.id.startsWith("kakao-")) return p;
      const addr = p.roadAddress || p.address;
      if (!addr) return p;
      const english = await geocodeEnglishAddress(addr);
      return english ? { ...p, englishAddress: english } : p;
    }),
  );
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
