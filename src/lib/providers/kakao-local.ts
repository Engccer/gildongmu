import { env } from "../env";
import type { Place, PlaceSearchParams, PlaceSearchResult } from "../types";

/**
 * 카카오 로컬(Local) 키워드 검색 provider.
 *
 * 네이버 지역 검색 대비 장점 (docs/RESEARCH 참고):
 * - 페이지당 최대 15건 (네이버는 5건)
 * - 좌표가 WGS84 그대로 (변환 불필요)
 * - place_url(카카오맵 상세 페이지) 제공
 *
 * 인증: Authorization: KakaoAK {REST_API_KEY} — 서버 전용.
 * 전제: 카카오 디벨로퍼스 앱에서 카카오맵(OPEN_MAP_AND_LOCAL) 서비스 활성화.
 * 비활성 시 401 NotAuthorizedError("disabled OPEN_MAP_AND_LOCAL service") 반환.
 */

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";

interface KakaoLocalDocument {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  /** 경도 (WGS84 십진 도 문자열) */
  x: string;
  /** 위도 (WGS84 십진 도 문자열) */
  y: string;
  place_url: string;
  distance: string;
}

interface KakaoLocalResponse {
  documents: KakaoLocalDocument[];
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
  };
}

export function normalizeDocument(doc: KakaoLocalDocument): Place {
  return {
    id: `kakao-${doc.id}`,
    name: doc.place_name,
    category: doc.category_name,
    address: doc.address_name,
    roadAddress: doc.road_address_name,
    lat: Number(doc.y),
    lng: Number(doc.x),
    phone: doc.phone || undefined,
    link: doc.place_url || undefined,
  };
}

export async function searchPlacesKakaoLocal(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", params.query);
  url.searchParams.set("size", String(Math.min(params.limit ?? 10, 15)));

  const res = await fetch(url, {
    headers: {
      Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}`,
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 로컬 검색 실패: HTTP ${res.status} ${body}`);
  }

  const data = (await res.json()) as KakaoLocalResponse;
  return {
    places: data.documents.map(normalizeDocument),
    provider: "kakao-local",
    query: params.query,
  };
}
