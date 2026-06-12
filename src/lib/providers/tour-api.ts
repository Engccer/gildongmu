import { env } from "../env";
import type { Place, PlaceSearchResult } from "../types";

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
