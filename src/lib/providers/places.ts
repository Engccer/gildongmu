import {
  hasJusoKey,
  hasKakaoKey,
  hasNaverLocalKeys,
  hasNcpMapsKeys,
  hasTourApiKey,
} from "../env";
import type { Place, PlaceSearchParams, PlaceSearchResult } from "../types";
import { annotateDistances, haversineMeters, sortByDistanceFrom } from "../geo";
import { searchPlacesKakaoLocal } from "./kakao-local";
import { searchPlacesMock } from "./mock";
import { searchPlacesNaverLocal } from "./naver-local";
import { geocodeEnglishAddress } from "./ncp-geocode";
import { geocodeEnglishAddressJuso } from "./juso-address";
import { searchPlacesTourApi } from "./tour-api";

/** 좌표 중복 판정 키 — 4자리(약 11m)면 같은 건물/장소로 본다. */
function coordKey(p: Place): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
}

/** 이름 비교용 정규화 — 공백·구두점 제거 + 소문자. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\-·.,()]/g, "");
}

/** 교차 provider 이름 중복 판정 반경. 실측 오프셋(카카오↔네이버 18~35m) 커버. */
const DEDUPE_RADIUS_M = 50;

/**
 * 교차 provider 중복 판정. 두 축의 OR:
 * 1. 좌표 4자리 일치 — en(카카오+TourAPI)의 정본 축(언어가 달라 이름 비교 불가).
 * 2. 50m 이내 + 정규화 이름의 가장자리 일치(동등/접두/접미, 짧은 쪽 ≥5자) —
 *    ko(카카오+네이버)는 같은 장소를 20~30m 어긋난 좌표로 줘 1이 미적중
 *    ("키자니아 서울" 이중 노출 실측 2026-07-20). 접두/접미로 제한하는 이유:
 *    지점명이 앵커 장소명을 품는 패턴("모모유부 키자니아서울점")은 가운데
 *    포함이라 배제되고, "키자니아 부산"↔"키자니아 부산점"(접두)·
 *    "곰두리체육센터"↔"시립곰두리체육센터"(접미)류 진짜 중복만 잡는다.
 */
function isDuplicate(a: Place, b: Place): boolean {
  if (coordKey(a) === coordKey(b)) return true;
  if (haversineMeters(a.lat, a.lng, b.lat, b.lng) > DEDUPE_RADIUS_M) return false;
  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  if (!na || !nb) return false;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return short.length >= 5 && (long.startsWith(short) || long.endsWith(short));
}

/**
 * 교차 provider 병합 유틸 — en(카카오+TourAPI)·ko(카카오+네이버) 공용.
 * primary(카카오) 전부를 순서 그대로 담고(정확도 축 보존 — primary 내부는
 * 중복 판정하지 않는다: 한 건물 안 별개 장소가 같은 좌표를 공유하는 경우가
 * 실재), secondary는 기존 항목과 중복이 아닌 것만 이어 붙인다.
 */
export function mergePlaces(primary: Place[], secondary: Place[]): Place[] {
  const merged = [...primary];
  for (const s of secondary) {
    if (merged.some((m) => isDuplicate(m, s))) continue;
    merged.push(s);
  }
  return merged;
}

/**
 * 장소 검색 진입점 — 키 유무와 로케일에 따라 provider를 자동 선택한다.
 *
 * 우선순위:
 * 1. en 로케일 + TourAPI 키 → tour-api (카카오·네이버 모두 다국어 미지원 —
 *    영문 장소명·주소를 주는 유일한 공식 소스이므로 외국인 시나리오 우선)
 * 2. ko: 카카오+네이버 両키 보유 시 병합(searchPlacesMergedKo) >
 *    kakao-local > naver-local > mock
 * - 카카오 우선 이유: 결과 최대 15건(네이버 5건), WGS84 좌표 그대로,
 *   place_url(카카오맵 상세) 제공 — 탐색 UX가 명백히 우위 (docs/RESEARCH 참고)
 * - 네이버 병합 이유: 카카오 미등록 가게 보강 — 커버리지 공백 실측 사례는
 *   searchPlacesMergedKo 주석 참고
 * - PLACES_PROVIDER 환경변수로 강제 지정 가능 (A/B 비교 실험용):
 *   "kakao" | "naver" | "tour" | "mock"
 *
 * 실데이터 호출이 실패하면 mock으로 폴백하지 않고 에러를 그대로 던진다 —
 * 조용한 폴백은 "실데이터처럼 보이는 가짜"를 만들어 디버깅을 방해하기 때문.
 */
export async function searchPlaces(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const result = await pickPlacesProvider(params);
  // 거리 "표기"는 서버 일원화 — 정렬 없이 주석만(정확도순 전환, 스펙 §1).
  // 리뷰순 결과도 이 주석만 지난다 — 재정렬하면 축이 그 자리에서 파괴된다.
  if (params.lat != null && params.lng != null) {
    return {
      ...result,
      places: annotateDistances(result.places, { lat: params.lat, lng: params.lng }),
    };
  }
  return result;
}

/** provider 선택 체인(기존 searchPlaces 본문 그대로 이동). */
async function pickPlacesProvider(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const forced = process.env.PLACES_PROVIDER;
  if (forced === "kakao") return searchPlacesKakaoLocal(params);
  if (forced === "naver") return searchPlacesNaverLocal(params);
  if (forced === "tour") return searchPlacesTourApi(params);
  if (forced === "mock") return searchPlacesMock(params);
  // 리뷰순은 병합하지 않는다(spec 2026-08-17 §2): 카카오를 뒤에 붙이면 6번째부터 축이
  // 아닌데 낭독은 선형이라 경계가 안 들린다. 키가 없으면 소비자가 부르지 말았어야 할
  // 요청 — 정확도순으로 조용히 폴백하면 사용자가 믿는 정렬과 다른 결과가 되므로 throw(§2.1).
  if (params.sort === "review") {
    if (!hasNaverLocalKeys()) {
      throw new Error("리뷰순 정렬은 네이버 지역검색 키가 필요합니다");
    }
    return searchPlacesNaverLocal(params);
  }
  if (params.lang === "en" && hasTourApiKey() && hasKakaoKey()) {
    return searchPlacesMergedEn(params);
  }
  if (params.lang === "en" && hasTourApiKey()) {
    return searchPlacesTourApi(params);
  }
  if (hasKakaoKey() && hasNaverLocalKeys() && params.lang !== "en") {
    return searchPlacesMergedKo(params);
  }
  if (hasKakaoKey()) return searchPlacesKakaoLocal(params);
  if (hasNaverLocalKeys()) return searchPlacesNaverLocal(params);
  return searchPlacesMock(params);
}

/**
 * ko 병합 검색 — 카카오(최대 15건, 정확도순)를 기본으로, 네이버 지역
 * (최대 5건)을 보강한다. 카카오 로컬 DB에 미등록인 가게가 네이버에만 있는
 * 커버리지 공백(예: 여의도 "백년찌개집 1971", 2026-07-18 실측)을 메우는 결정.
 *
 * - 두 소스 병렬 호출, 한쪽 실패해도 다른 쪽 실데이터는 보존(MergedEn 동형).
 * - 중복 제거는 좌표 4자리(mergePlaces 재사용).
 * - 카카오 정확도순 15건 뒤에 네이버 5건(자체 정확도순)을 이어 붙인다. 네이버
 *   전용 근처 가게가 하단에 오는 트레이드오프는 수용(보강 소스 역할, 스펙 §1).
 *   재정렬은 하지 않는다 — 정확도 축 보존.
 */
export async function searchPlacesMergedKo(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const [kakaoR, naverR] = await Promise.allSettled([
    searchPlacesKakaoLocal(params),
    searchPlacesNaverLocal(params),
  ]);

  if (kakaoR.status === "rejected" && naverR.status === "rejected") {
    throw kakaoR.reason;
  }
  if (kakaoR.status === "rejected") {
    console.error("[places] ko 병합 — 카카오 실패:", kakaoR.reason);
  }
  if (naverR.status === "rejected") {
    console.error("[places] ko 병합 — 네이버 실패:", naverR.reason);
  }

  const kakao = kakaoR.status === "fulfilled" ? kakaoR.value.places : [];
  const naver = naverR.status === "fulfilled" ? naverR.value.places : [];
  const merged = mergePlaces(kakao, orderSupplementTail(naver, params));
  return {
    places: promoteCoverageGapMatches(merged, kakao, params.query),
    provider: "merged",
    query: params.query,
  };
}

/**
 * 커버리지 공백 승격 — primary(카카오)에 질의명을 포함한 항목이 하나도 없을
 * 때만, 질의명을 포함한 보강 항목을 리스트 최상단으로 올린다(그 외엔 무변경).
 * 네이버 보강의 존재 이유인 "카카오 미등록 가게"(여의도 백년찌개집 1971 실측)
 * 가 유사 이름 카카오 결과 + 거리 꼬리 정렬에 밀려 최하단에 깔리는 회귀 수정
 * (2026-07-21). 카카오가 질의명을 찾는 일반 검색(맥도날드·아쿠아리움)에서는
 * 발동하지 않아 정확도 축 불변. 승격 항목 간 상대 순서는 보존(안정 분할).
 */
export function promoteCoverageGapMatches(
  merged: Place[],
  primary: Place[],
  query: string,
): Place[] {
  const q = normalizeName(query);
  if (q.length < 2) return merged;
  const matches = (p: Place) => normalizeName(p.name).includes(q);
  if (primary.some(matches)) return merged;
  const hit = merged.filter(matches);
  if (hit.length === 0) return merged;
  return [...hit, ...merged.filter((p) => !matches(p))];
}

/**
 * 병합 검색의 보강 꼬리(네이버·TourAPI) 정렬 — 좌표가 있으면 거리 오름차순.
 * 카카오 본체는 정확도+근접 블렌딩이 이미 근사 거리순을 주지만, 보강 소스는
 * 좌표 파라미터가 없어(네이버) 전국 순서 그대로 꼬리에 붙는다 → 낭독 시
 * "…6.5km 다음에 15km 시청점"으로 거리 흐름이 깨진다(2026-07-21 맥도날드
 * 실측). 꼬리 내부만 정렬하므로 카카오 정확도 축은 침범하지 않는다.
 */
function orderSupplementTail(places: Place[], params: PlaceSearchParams): Place[] {
  if (params.lat == null || params.lng == null) return places;
  return sortByDistanceFrom(places, { lat: params.lat, lng: params.lng });
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
  const merged = promoteCoverageGapMatches(
    mergePlaces(kakao, orderSupplementTail(tour, params)),
    kakao,
    params.query,
  );
  return {
    places:
      hasJusoKey() || hasNcpMapsKeys()
        ? await enrichEnglishAddresses(merged)
        : merged,
    provider: "merged",
    query: params.query,
  };
}

/**
 * 카카오 출신 카드(한글 주소)에만 영문 주소를 폴백 체인으로 보강한다.
 * TourAPI 카드는 이미 영문 주소(addr1)를 가지므로 변환하지 않는다.
 *
 * 폴백 우선순위: juso(행안부 공식) → NCP. 둘 다 best-effort(throw 안 함)라
 * ?? 로 합성된다. 각 provider는 키가 있을 때만 호출해 빈 키 fetch 낭비를 막는다.
 * 둘 다 null/키없음이면 영문 주소 없이 한글만 남는다(graceful degrade).
 */
export async function enrichEnglishAddresses(
  places: Place[],
): Promise<Place[]> {
  return Promise.all(
    places.map(async (p) => {
      if (!p.id.startsWith("kakao-")) return p;
      const addr = p.roadAddress || p.address;
      if (!addr) return p;
      const english =
        (hasJusoKey() ? await geocodeEnglishAddressJuso(addr) : null) ??
        (hasNcpMapsKeys() ? await geocodeEnglishAddress(addr) : null);
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
