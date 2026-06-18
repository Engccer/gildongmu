import { env } from "../env";
import type { JusoAddress } from "../types";

/**
 * 행안부 도로명주소 검색 API provider — 공식 영문 주소·우편번호의 정본 소스.
 *
 * 두 쓰임:
 * - geocodeEnglishAddressJuso: en 카카오 카드 영문 주소 보강(C2-a, NCP 대체).
 * - searchJusoAddresses: 주소·우편번호 검색 진입점(C2-b, 묶음 2에서 추가).
 *
 * 엔드포인트: https://business.juso.go.kr/addrlink/addrLinkApi.do
 * 인증: confmKey 쿼리 파라미터(서버 전용).
 * 실응답(2026-06-19): results.common.errorCode "0"=정상(무결과도 "0"+totalCount "0"),
 * results.juso[]에 roadAddr·roadAddrPart1·jibunAddr·engAddr·zipNo·bdNm.
 */

const ENDPOINT = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

interface JusoRawItem {
  roadAddr: string;
  roadAddrPart1: string;
  jibunAddr: string;
  engAddr: string;
  zipNo: string;
  bdNm: string;
}

interface JusoApiResponse {
  results: {
    common: {
      errorCode: string;
      errorMessage: string;
      totalCount: string;
      currentPage: string;
      countPerPage: string;
    };
    juso: JusoRawItem[] | null;
  };
}

/**
 * 응답 → JusoAddress[]. errorCode "0"이면 juso[]를 매핑(무결과는 빈 배열),
 * 그 외 코드는 throw한다 — 검색 본류의 장애를 빈 결과로 가리지 않기 위해.
 */
export function normalizeJusoResults(raw: JusoApiResponse): JusoAddress[] {
  const code = raw.results?.common?.errorCode;
  if (code !== "0") {
    throw new Error(
      `juso 주소 검색 오류: ${code} ${raw.results?.common?.errorMessage ?? ""}`,
    );
  }
  return (raw.results.juso ?? []).map((j) => ({
    roadAddr: j.roadAddr,
    roadAddrPart1: j.roadAddrPart1,
    jibunAddr: j.jibunAddr,
    engAddr: j.engAddr,
    zipNo: j.zipNo,
    bdNm: j.bdNm,
  }));
}

/**
 * 첫 결과의 공식 영문 주소만 추출 — best-effort라 throw하지 않는다.
 * 무결과·빈 문자열·에러코드는 모두 null(geocodeEnglishAddressJuso가 흡수).
 */
export function extractEnglishAddressJuso(raw: JusoApiResponse): string | null {
  try {
    const eng = normalizeJusoResults(raw)[0]?.engAddr?.trim();
    return eng ? eng : null;
  } catch {
    return null;
  }
}

/**
 * 한글 주소 → 공식 영문 주소. 무결과·실패면 null.
 *
 * 영문 주소는 best-effort 보강이므로 절대 throw하지 않는다 — juso 장애·HTTP
 * 에러·네트워크 예외는 모두 null로 흡수하고, 호출부(enrichEnglishAddresses)는
 * 다음 폴백(NCP) 또는 한글 주소로 graceful degrade한다.
 * (NCP geocodeEnglishAddress와 동일 계약 — 폴백 체인이 ?? 로 합성된다.)
 */
export async function geocodeEnglishAddressJuso(
  koreanAddress: string,
): Promise<string | null> {
  if (!koreanAddress.trim()) return null;
  try {
    const url = new URL(ENDPOINT);
    url.searchParams.set("confmKey", env.JUSO_CONFM_KEY ?? "");
    url.searchParams.set("currentPage", "1");
    url.searchParams.set("countPerPage", "1");
    url.searchParams.set("keyword", koreanAddress);
    url.searchParams.set("resultType", "json");

    const res = await fetch(url, {
      // 주소→영문 주소는 사실상 불변 — 하루 캐시(NCP geocode 동형)
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as JusoApiResponse;
    return extractEnglishAddressJuso(data);
  } catch (e) {
    console.error("[juso-address] 영문 주소 변환 실패:", koreanAddress, e);
    return null;
  }
}

/**
 * 키워드 → 정규화된 주소 목록. 검색 본류라 에러를 throw한다(라우트가 502 분류).
 * 무결과는 errorCode "0"이라 빈 배열로 정상 반환된다.
 */
export async function searchJusoAddresses(
  keyword: string,
  page = 1,
  size = 10,
): Promise<JusoAddress[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("confmKey", env.JUSO_CONFM_KEY ?? "");
  url.searchParams.set("currentPage", String(page));
  url.searchParams.set("countPerPage", String(size));
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("resultType", "json");

  const res = await fetch(url, {
    // 주소는 준정적 — 1시간 캐시(쿼터 보호, 카카오 주소검색 동형)
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`juso 주소 검색 실패: HTTP ${res.status} ${body}`);
  }

  const data = (await res.json()) as JusoApiResponse;
  return normalizeJusoResults(data);
}
