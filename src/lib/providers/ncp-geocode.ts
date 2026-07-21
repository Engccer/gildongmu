import { env } from "../env";
import type { Coord } from "../types";

/**
 * NCP Maps Geocoding/Reverse Geocoding — 카카오가 비워 둔 주소 공백을
 * 메우는 단일 목적 provider(영문 주소 보강 + 도로명 역지오코딩 폴백).
 *
 * 영문 주소 변환:
 * 카카오 로컬 검색 결과는 한글 주소만 주므로, 외국인 영문 UI(en)에서
 * 카카오 카드에 영문 도로명 주소를 보강할 때 쓴다. 카카오·TourAPI가
 * 비워 둔 "영문 주소" 공백을 메우는 NCP의 유일한 실익(2026-06-13 결정).
 *
 * - 엔드포인트: https://maps.apigw.ntruss.com/map-geocode/v2/geocode
 * - 인증 헤더: x-ncp-apigw-api-key-id / x-ncp-apigw-api-key (서버 전용)
 * - 실응답(2026-06-13): addresses[0].englishAddress에
 *   "161, Sajik-ro, Jongno-gu, Seoul, Republic of Korea" 형태로 온다.
 *   결과 없으면 addresses는 빈 배열, totalCount 0.
 *
 * 도로명 역지오코딩 폴백:
 * 카카오 coord2address는 좌표가 도로명주소 건물에 매핑 안 되면
 * road_address가 null이라 "현재 위치" 병기 주소가 지번으로 표시되는
 * 문제가 있다(2026-07-22 위원장 피드백). NCP map-reversegeocode는 같은
 * 좌표에서 최근접 도로명을 준다(실호출 확인: 127.1465,37.5354 →
 * status.name "ok", area1 "서울특별시"/area2 "강동구", land "천호대로"/
 * number1 "1220" → "서울특별시 강동구 천호대로 1220").
 */

interface NcpGeocodeAddress {
  roadAddress: string;
  jibunAddress: string;
  englishAddress: string;
}

interface NcpGeocodeResponse {
  status: string;
  meta: { totalCount: number };
  addresses: NcpGeocodeAddress[];
}

/** 응답에서 영문 주소만 추출 — 무결과·빈 문자열은 null. */
export function extractEnglishAddress(res: NcpGeocodeResponse): string | null {
  const eng = res.addresses?.[0]?.englishAddress?.trim();
  return eng ? eng : null;
}

/**
 * 한글 주소(도로명 우선) → 영문 주소. 무결과·실패면 null.
 *
 * 영문 주소는 best-effort 보강이므로 절대 throw하지 않는다 — NCP 장애·HTTP
 * 에러·네트워크 예외는 모두 null로 흡수하고, 호출부는 한글 주소로 graceful
 * degrade한다. (장소 검색 본류를 영문 주소 변환 실패가 깨지 않게.)
 */
export async function geocodeEnglishAddress(
  koreanAddress: string,
): Promise<string | null> {
  if (!koreanAddress.trim()) return null;

  try {
    const url = new URL("https://maps.apigw.ntruss.com/map-geocode/v2/geocode");
    url.searchParams.set("query", koreanAddress);

    const res = await fetch(url, {
      headers: {
        "x-ncp-apigw-api-key-id": env.NCP_MAPS_CLIENT_ID ?? "",
        "x-ncp-apigw-api-key": env.NCP_MAPS_CLIENT_SECRET ?? "",
      },
      // 주소→영문 주소는 사실상 불변 — 하루 캐시
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${body}`);
    }

    const data = (await res.json()) as NcpGeocodeResponse;
    return extractEnglishAddress(data);
  } catch (e) {
    console.error("[ncp-geocode] 영문 주소 변환 실패:", koreanAddress, e);
    return null;
  }
}

interface NcpReverseGeocodeRegionArea {
  name: string;
}

interface NcpReverseGeocodeLand {
  name: string;
  number1: string;
  number2?: string;
}

interface NcpReverseGeocodeResult {
  name: string;
  region: {
    area1: NcpReverseGeocodeRegionArea;
    area2: NcpReverseGeocodeRegionArea;
  };
  land?: NcpReverseGeocodeLand;
}

interface NcpReverseGeocodeResponse {
  status: { code: number; name: string; message: string };
  results: NcpReverseGeocodeResult[];
}

/**
 * 응답에서 도로명 주소 문자열만 추출.
 * area1(시·도)+area2(구·군)+land.name(도로명)+land.number1(건물번호,
 * number2 있으면 "-" 연결)을 공백 조립 — "서울특별시 강동구 천호대로 1220".
 * status.name이 "ok"가 아니거나 results가 비었거나 land.name이 없으면
 * (도로명 매핑 없음) null.
 */
export function extractRoadAddress(
  res: NcpReverseGeocodeResponse,
): string | null {
  if (res.status?.name !== "ok") return null;

  const result = res.results?.[0];
  const land = result?.land;
  if (!land?.name) return null;

  const buildingNumber = land.number2
    ? `${land.number1}-${land.number2}`
    : land.number1;

  return [
    result.region?.area1?.name,
    result.region?.area2?.name,
    land.name,
    buildingNumber,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * 좌표 → 최근접 도로명 주소 (역지오코딩). 무결과면 null.
 *
 * 카카오 coord2address의 road_address null 폴백 전용 — best-effort
 * 보조이므로 호출부(라우트)가 try/catch로 삼킨다. 그래서 이 함수 자체는
 * geocodeEnglishAddress와 달리 HTTP 실패·네트워크 예외를 삼키지 않고
 * 그대로 throw한다(기존 provider 관례: kakao-address.ts의 coordToAddress
 * 도 동일하게 throw).
 */
export async function reverseRoadAddress(coord: Coord): Promise<string | null> {
  const url = new URL("https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc");
  url.searchParams.set("coords", `${coord.lng},${coord.lat}`);
  url.searchParams.set("orders", "roadaddr");
  url.searchParams.set("output", "json");

  const res = await fetch(url, {
    headers: {
      "x-ncp-apigw-api-key-id": env.NCP_MAPS_CLIENT_ID ?? "",
      "x-ncp-apigw-api-key": env.NCP_MAPS_CLIENT_SECRET ?? "",
    },
    // 같은 좌표의 최근접 도로명은 사실상 불변 — 1시간 캐시
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${body}`);
  }

  const data = (await res.json()) as NcpReverseGeocodeResponse;
  return extractRoadAddress(data);
}
