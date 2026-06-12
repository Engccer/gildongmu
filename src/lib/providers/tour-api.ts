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
 * - 인증: data.go.kr serviceKey (일 100,000건 무료)
 *   ⚠ 키는 "Decoding" 버전을 환경변수에 넣을 것 — URLSearchParams가
 *   인코딩을 담당하므로 Encoding 키를 넣으면 이중 인코딩으로 401이 난다.
 * - 좌표: mapx(경도)/mapy(위도) WGS84 십진 도.
 *
 * 미검증(키 발급 대기): 빈 결과 시 items가 "" 문자열로 오는 동작과
 * contenttypeid 라벨은 실호출로 확인 후 확정한다 (docs/SPEC.md 미해결 항목).
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

export function normalizeTourItem(item: TourApiItem): Place {
  return {
    id: `tour-${item.contentid}`,
    name: item.title,
    // contenttypeid 숫자 코드 → 라벨 매핑은 실호출 검증 후 확정 (위 주석)
    category: "",
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
