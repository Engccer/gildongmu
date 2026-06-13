import { env } from "../env";

/**
 * NCP Maps Geocoding — 한글 주소를 영문 주소로 변환하는 단일 목적 provider.
 *
 * 카카오 로컬 검색 결과는 한글 주소만 주므로, 외국인 영문 UI(en)에서
 * 카카오 카드에 영문 도로명 주소를 보강할 때 쓴다. 카카오·TourAPI가
 * 비워 둔 "영문 주소" 공백을 메우는 NCP의 유일한 실익(2026-06-13 결정).
 *
 * - 엔드포인트: https://maps.apigw.ntruss.com/map-geocode/v2/geocode
 * - 인증 헤더: x-ncp-apigw-api-key-id / x-ncp-apigw-api-key (서버 전용)
 * - 실응답(2026-06-13): addresses[0].englishAddress에
 *   "161, Sajik-ro, Jongno-gu, Seoul, Republic of Korea" 형태로 온다.
 *   결과 없으면 addresses는 빈 배열, totalCount 0.
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
