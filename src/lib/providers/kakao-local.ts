import { roundCoord } from "../coord-round";
import { env } from "../env";
import { categoryEnField } from "../kakao-category";
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

export interface KakaoLocalDocument {
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

export interface KakaoLocalResponse {
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
    // 영문 분류(A28) — 전부 등재일 때만 키가 실린다. 판정 축은 위 원문 `category`.
    ...categoryEnField(doc.category_name),
    address: doc.address_name,
    roadAddress: doc.road_address_name,
    lat: Number(doc.y),
    lng: Number(doc.x),
    phone: doc.phone || undefined,
    link: doc.place_url || undefined,
  };
}

/**
 * 검색 URL 빌더(순수) — query·size에 더해, 좌표가 둘 다 있으면 x(경도)·y(위도)를
 * 붙인다. sort는 지정하지 않는다(기본 정확도순) — 좌표가 있으면 카카오가 근접성을
 * 관련도에 블렌딩한다(실호출 확정 2026-07-20: "맥도날드"는 근처 지점 상위,
 * "경복궁"은 15km 밖에서도 본체·부속 명소 최상단). radius도 미지정(0건 위험 회피).
 */
export function buildKakaoSearchUrl(params: PlaceSearchParams): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", params.query);
  url.searchParams.set("size", String(Math.min(params.limit ?? 10, 15)));
  if (params.lat != null && params.lng != null) {
    url.searchParams.set("x", String(params.lng));
    url.searchParams.set("y", String(params.lat));
  }
  return url;
}

/**
 * 출입구 POI 후보 조회(A11 목적지 승격).
 *
 * ⚠ **질의어는 `"{목적지명} 출입구"`다.** 목적지명 단독 질의는 불안정하다 — 실측에서
 * `고덕그라시움`은 게이트 6개를 주는데 실제 POI 이름인 `고덕그라시움아파트`는 0개다
 * (2026-08-16). 카카오가 출입구에 붙이는 카테고리는 `교통,수송 > 입출구`이고, 지하철
 * 출구는 `지하철출구`로 **다른 카테고리**라 오탐하지 않는다.
 *
 * ⚠ `x`/`y`에 **목적지 좌표**를 넘긴다(사용자 좌표가 아니다). 관련도 블렌딩이 타 시설
 * 혼입을 줄이고, 어느 출입구를 고를지는 서버 순수 계층(`chooseEntrance`)이 정하지
 * 응답 순위가 정하지 않는다. 좌표는 `roundCoord(…,4)`(±5.5m)로 뭉쳐 **캐시 키**가
 * 되게 한다 — 원시 좌표를 그대로 실으면 적중률이 사실상 0이라 캐시가 쿼터를 아끼지
 * 못한다(`kakao-walk` 선례).
 *
 * 1페이지(15건)만 본다. 포화된 응답에서 자격 후보가 0이면 승격하지 않는다 —
 * 2페이지 추적은 호출·지연을 배로 늘린다(명시적 판정, spec §2.1).
 */
export async function searchEntranceCandidatesKakao(
  name: string,
  dest: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<KakaoLocalDocument[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", `${name} 출입구`);
  url.searchParams.set("size", "15");
  url.searchParams.set("x", roundCoord(dest.lng, 4));
  url.searchParams.set("y", roundCoord(dest.lat, 4));

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    signal,
    // 출입구 POI는 정적이지만 이 엔드포인트(kakao-local)의 판정값은 300이다.
    // 같은 엔드포인트에 네 번째 캐시 수명을 새로 놓지 않는다(백로그 §9 카카오 캐시 행).
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 출입구 검색 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as KakaoLocalResponse;
  return data.documents;
}

export async function searchPlacesKakaoLocal(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const url = buildKakaoSearchUrl(params);

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
