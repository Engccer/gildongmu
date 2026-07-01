import { env } from "../env";
import { haversineMeters } from "../geo";
import type { Place, PlaceSearchParams, PlaceSearchResult } from "../types";
import {
  ENDPOINT,
  normalizeDocument,
  type KakaoLocalDocument,
  type KakaoLocalResponse,
} from "./kakao-local";

/**
 * 관광지·명소 검색 provider — 카카오 로컬 키워드를 **정확도순**(좌표·sort 없이)
 * 으로 호출해, category_name이 "여행 > 관광,명소"인 항목만 추린다.
 *
 * ⚠ 판별은 category_group_code "AT4"가 아니라 category_name 계층으로 한다.
 * 경복궁 본궁만 AT4이고 경회루·근정전 등 부속은 group code가 빈 문자열이라
 * AT4로 필터하면 진짜 명소를 놓친다(실호출 확정). kids-places가 쓰는
 * category_name 화이트리스트 패턴과 동형.
 *
 * 거리순(내 주변, /api/places)과 정렬 방식이 반대라 한 호출로 둘 다 못 만든다 —
 * 검색 시 이 provider를 거리순 place 검색과 병렬 호출한다.
 */
export const ATTRACTION_CATEGORY_PREFIX = "여행 > 관광,명소";

/** 명소 표시 상한 — 대표 명소 + 상위 부속. accuracy 순서라 대표가 맨 위. */
export const ATTRACTION_CAP = 5;

export function isAttraction(category: string): boolean {
  return category.startsWith(ATTRACTION_CATEGORY_PREFIX);
}

/** 정확도순 URL — 좌표·sort를 붙이지 않는다(거리순이면 명소가 밀려남). */
export function buildAttractionSearchUrl(params: PlaceSearchParams): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", params.query);
  url.searchParams.set("size", "15");
  return url;
}

/**
 * 응답 문서에서 명소만 추출 — 필터 → (좌표 있으면) Haversine 거리 주입 → cap.
 * accuracy 순서 유지(정렬 안 함) — 대표 명소가 맨 위.
 */
export function extractAttractions(
  docs: KakaoLocalDocument[],
  params: PlaceSearchParams,
): Place[] {
  const places = docs
    .map(normalizeDocument)
    .filter((p) => isAttraction(p.category));
  const { lat, lng } = params;
  const withDistance =
    lat != null && lng != null
      ? places.map((p) => ({
          ...p,
          distanceMeters: Math.round(haversineMeters(lat, lng, p.lat, p.lng)),
        }))
      : places;
  return withDistance.slice(0, ATTRACTION_CAP);
}

/** ko 명소 검색 — 카카오 로컬 정확도순 + category_name 필터. */
export async function searchAttractionsKakao(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const url = buildAttractionSearchUrl(params);
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 명소 검색 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as KakaoLocalResponse;
  return {
    places: extractAttractions(data.documents, params),
    provider: "kakao-attractions",
    query: params.query,
  };
}
