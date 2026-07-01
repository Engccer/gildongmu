import { env } from "../env";
import { haversineMeters } from "../geo";
import type { Place, PlaceSearchParams, PlaceSearchResult } from "../types";

/**
 * 한국관광공사 TourAPI 4.0 키워드 검색 provider.
 *
 * 카카오·네이버가 모두 비워 둔 **다국어 공백**을 메우는 유일한 공식 소스 —
 * 언어별로 독립 서비스가 있고(영문 EngService2 등) title/addr가 해당
 * 언어로 번역되어 내려온다. 외국인 여행자 시나리오의 코어 데이터.
 *
 * - 엔드포인트: https://apis.data.go.kr/B551011/{서비스}/searchKeyword2
 * - 인증: data.go.kr serviceKey. 신형 GW 서비스는 hex 64자 단일 키
 *   (Encoding/Decoding 구분 없음). 승인 직후 30분~1시간은 게이트웨이
 *   전파 전이라 401 Unauthorized가 난다 (2026-06-13 실측: 약 10분).
 * - 쿼터: 개발계정은 상세기능당 일 1,000건 (운영계정 전환 시 상향).
 * - 좌표: mapx(경도)/mapy(위도) WGS84 십진 도.
 *
 * 실호출 검증 완료 (2026-06-13): 빈 결과 시 items는 빈 문자열("")로
 * 온다. contenttypeid는 국문(12~39)·영문(75~85) 코드가 겹치지 않아
 * 단일 맵으로 라벨링한다 (아래 CONTENT_TYPE_LABELS).
 */

/** 지원 언어 → TourAPI 서비스 이름 (필요 시 Jpn/Chs 등 추가) */
const LANG_TO_SERVICE: Record<string, string> = {
  ko: "KorService2",
  en: "EngService2",
};

interface TourApiItem {
  contentid: string;
  contenttypeid: string;
  title: string;
  addr1: string;
  addr2: string;
  /** 경도 (WGS84 십진 도 문자열) */
  mapx: string;
  /** 위도 (WGS84 십진 도 문자열) */
  mapy: string;
  tel: string;
  firstimage: string;
}

interface TourApiResponse {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      /** 결과 없으면 빈 문자열("")로 오는 것으로 알려짐 — 방어 처리 */
      items: { item: TourApiItem[] } | "" | null;
      totalCount: number;
    };
  };
}

/**
 * contenttypeid → 사람이 읽을 카테고리 라벨.
 * 국문 서비스(KorService2)와 영문 서비스(EngService2)는 코드 체계가
 * 다르지만 값이 겹치지 않으므로 (국문 12~39, 영문 75~85) 한 맵으로 처리.
 * 출처: TourAPI 4.0 공식 개발 가이드 + 2026-06-13 실응답 확인.
 */
const CONTENT_TYPE_LABELS: Record<string, string> = {
  // 국문 (KorService2)
  "12": "관광지",
  "14": "문화시설",
  "15": "축제·공연·행사",
  "25": "여행코스",
  "28": "레포츠",
  "32": "숙박",
  "38": "쇼핑",
  "39": "음식점",
  // 영문 (EngService2)
  "75": "Leisure Sports",
  "76": "Tourist Attraction",
  "77": "Transportation",
  "78": "Cultural Facility",
  "79": "Shopping",
  "80": "Accommodation",
  "82": "Restaurant",
  "85": "Festival & Event",
};

export function normalizeTourItem(item: TourApiItem): Place {
  return {
    id: `tour-${item.contentid}`,
    name: item.title,
    category: CONTENT_TYPE_LABELS[item.contenttypeid] ?? "",
    address: [item.addr1, item.addr2].filter(Boolean).join(" "),
    roadAddress: item.addr1 || "",
    lat: Number(item.mapy),
    lng: Number(item.mapx),
    phone: item.tel || undefined,
    link: undefined,
  };
}

/**
 * en 명소 검색 — EngService2 `searchKeyword2` + `contentTypeId=76`(Tourist
 * Attraction). 카카오 명소(ko)는 한글명만 줘 외국인이 못 읽으므로, 영문명을
 * 주는 TourAPI로 en 명소 섹션을 채운다. contentTypeId를 서버측에서 걸러
 * 동명 매장(79 Shopping 등)이 배제되고 진짜 랜드마크가 상단에 온다
 * (실호출 확정: "Gyeongbokgung"+76 → 1건 "Gyeongbokgung Palace").
 * ko의 kakao category_name "여행 > 관광,명소" 필터에 대응하는 en 신호.
 */
export const ATTRACTION_CONTENT_TYPE_ID = "76";

/** en 명소 표시 상한 — ko(kakao-attractions)와 동일 개념. accuracy 순서 유지. */
const ATTRACTION_CAP = 5;

/** en 명소 검색 URL(순수) — contentTypeId=76으로 소스에서 관광지만 추린다. */
export function buildTourAttractionUrl(params: PlaceSearchParams): URL {
  const url = new URL(
    "https://apis.data.go.kr/B551011/EngService2/searchKeyword2",
  );
  url.searchParams.set("serviceKey", env.TOUR_API_KEY ?? "");
  url.searchParams.set("MobileOS", "WEB");
  url.searchParams.set("MobileApp", "gildongmu");
  url.searchParams.set("_type", "json");
  url.searchParams.set("keyword", params.query);
  url.searchParams.set("numOfRows", "15");
  url.searchParams.set("arrange", "A");
  url.searchParams.set("contentTypeId", ATTRACTION_CONTENT_TYPE_ID);
  return url;
}

/**
 * 명소 항목 추출(순수) — 정규화 → (좌표 있으면) Haversine 거리 주입·거리순 정렬 → cap.
 * contentTypeId로 이미 관광지만 왔으므로 카테고리 재필터는 불필요.
 *
 * ⚠ 정렬 정책이 ko(kakao-attractions)와 다르다. kakao는 정확도순이 대표 명소를
 * 1위로 올리지만 TourAPI엔 인기/정확도순 arrange가 없어 어떤 순서(제목·이미지·
 * 수정일)도 먼 동명(청도·경주 남산)을 상단에 올린다(실호출 확정). 좌표가 있는
 * 사용자에겐 근접성이 유일한 관련도 신호이므로 거리순으로 정렬해 가장 가까운
 * 실제 관광지(남산 케이블카)를 먼저 보인다. 좌표가 없으면 소스 순서(제목순) 유지.
 * "경복궁"처럼 결과 1건이면 정렬은 무영향이라 신고 케이스는 그대로 해결된다.
 */
export function extractTourAttractions(
  items: TourApiItem[],
  params: PlaceSearchParams,
): Place[] {
  const places = items.map(normalizeTourItem);
  const { lat, lng } = params;
  if (lat == null || lng == null) return places.slice(0, ATTRACTION_CAP);
  return places
    .map((p) => ({
      ...p,
      distanceMeters: Math.round(haversineMeters(lat, lng, p.lat, p.lng)),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, ATTRACTION_CAP);
}

export async function searchAttractionsTourApi(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const res = await fetch(buildTourAttractionUrl(params), {
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TourAPI 명소 검색 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as TourApiResponse;
  const header = data.response?.header;
  if (header && header.resultCode !== "0000") {
    throw new Error(
      `TourAPI 명소 검색 실패 (${header.resultCode}): ${header.resultMsg}`,
    );
  }
  const items = data.response?.body?.items;
  const rawItems = items && typeof items === "object" ? items.item : [];
  return {
    places: extractTourAttractions(rawItems, params),
    provider: "tour-api",
    query: params.query,
  };
}

export async function searchPlacesTourApi(params: {
  query: string;
  limit?: number;
  lang?: string;
}): Promise<PlaceSearchResult> {
  const service = LANG_TO_SERVICE[params.lang ?? "ko"] ?? "KorService2";
  const url = new URL(
    `https://apis.data.go.kr/B551011/${service}/searchKeyword2`,
  );
  url.searchParams.set("serviceKey", env.TOUR_API_KEY ?? "");
  url.searchParams.set("MobileOS", "WEB");
  url.searchParams.set("MobileApp", "gildongmu");
  url.searchParams.set("_type", "json");
  url.searchParams.set("keyword", params.query);
  url.searchParams.set("numOfRows", String(params.limit ?? 10));
  url.searchParams.set("arrange", "A");

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TourAPI 검색 실패: HTTP ${res.status} ${body}`);
  }

  const data = (await res.json()) as TourApiResponse;
  const header = data.response?.header;
  if (header && header.resultCode !== "0000") {
    throw new Error(
      `TourAPI 검색 실패 (${header.resultCode}): ${header.resultMsg}`,
    );
  }

  const items = data.response?.body?.items;
  const rawItems = items && typeof items === "object" ? items.item : [];
  return {
    places: rawItems.map(normalizeTourItem),
    provider: "tour-api",
    query: params.query,
  };
}
