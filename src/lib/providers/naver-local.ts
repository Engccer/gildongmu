import { env } from "../env";
import type { Place, PlaceSearchParams, PlaceSearchResult } from "../types";

/**
 * developers.naver.com 지역(Local) 검색 API provider.
 *
 * 제약 (2026-06 조사 기준, docs/research/RESEARCH-2026-06-naver-api-ecosystem.md 참고):
 * - display 최대 5건 (다른 검색 API의 100건과 달리 지역만 5건)
 * - 일일 쿼터 25,000회 (검색 API 공통)
 * - mapx/mapy는 WGS84 경위도 × 10^7 정수 → 10^7로 나눠 십진 도로 변환
 * - 업체명에 <b>...</b> 강조 태그가 섞여 옴 → 평문으로 제거
 * - 서버 전용: Client Secret이 필요하므로 반드시 Route Handler에서만 호출
 */

const ENDPOINT = "https://openapi.naver.com/v1/search/local.json";
const COORD_SCALE = 10_000_000;

interface NaverLocalItem {
  title: string;
  link: string;
  category: string;
  description: string;
  telephone: string;
  address: string;
  roadAddress: string;
  mapx: string;
  mapy: string;
}

/** 오류 봉투(예: 무효 sort → SE04). 실측 2026-08-17엔 HTTP 400과 함께 와서 `res.ok` 가드가
 * 먼저 잡지만, 200 + 봉투로 오는 경우도 items가 없어 조용한 TypeError가 되므로 방어한다. */
interface NaverErrorEnvelope {
  errorCode: string;
  errorMessage?: string;
}

interface NaverLocalResponse {
  total: number;
  start: number;
  display: number;
  items: NaverLocalItem[];
}

/** <b> 강조 태그 등 HTML 태그와 엔티티를 제거해 스크린 리더가 읽을 평문으로 만든다 */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/** mapx/mapy(WGS84 × 10^7 정수 문자열) → WGS84 십진 도 */
export function toWgs84(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`좌표 파싱 실패: ${raw}`);
  }
  return n / COORD_SCALE;
}

export function normalizeItem(item: NaverLocalItem, index: number): Place {
  const name = stripHtml(item.title);
  return {
    id: `naver-local-${index}-${name}`,
    name,
    category: item.category,
    address: item.address,
    roadAddress: item.roadAddress,
    lat: toWgs84(item.mapy),
    lng: toWgs84(item.mapx),
    phone: item.telephone || undefined,
    link: item.link || undefined,
  };
}

export async function searchPlacesNaverLocal(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", params.query);
  // 리뷰순(sort=comment)은 네이버가 5로 캡하므로 limit을 이중으로 두지 않는다(spec §3.2).
  // 미지정이면 sort 파라미터를 붙이지 않는다(기존 요청과 바이트 동일).
  if (params.sort === "review") {
    url.searchParams.set("sort", "comment");
    url.searchParams.set("display", "5");
  } else {
    url.searchParams.set("display", String(Math.min(params.limit ?? 5, 5)));
  }

  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": env.NAVER_LOCAL_CLIENT_ID!,
      "X-Naver-Client-Secret": env.NAVER_LOCAL_CLIENT_SECRET!,
    },
    // 동일 검색어 반복 호출 시 일일 쿼터(25,000회) 절약
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(`네이버 지역 검색 실패: HTTP ${res.status}`);
  }

  const data = (await res.json()) as NaverLocalResponse | NaverErrorEnvelope;
  // 오류 봉투를 먼저 본다 — items가 없어 조용한 TypeError로 원인이 가려지지 않게.
  if ("errorCode" in data) {
    throw new Error(
      `네이버 지역 검색 오류: ${data.errorCode} ${data.errorMessage ?? ""}`.trim(),
    );
  }
  return {
    places: data.items.map(normalizeItem),
    provider: "naver-local",
    query: params.query,
  };
}
