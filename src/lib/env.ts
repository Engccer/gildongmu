import { z } from "zod";

/**
 * 서버 전용 환경변수 검증.
 *
 * 모든 키는 선택(optional)이다 — 키가 없으면 mock provider로 폴백하므로
 * 환경변수 없이도 dev 서버가 항상 뜬다.
 *
 * 키 체계 주의 (2025년 NCP Maps 개편 이후):
 * - NCP Maps (Geocoding/Directions/Static Map): 신규 "Maps" 상품의
 *   Client ID/Secret. REST 헤더 x-ncp-apigw-api-key-id / x-ncp-apigw-api-key.
 * - JS SDK(Dynamic Map): NCP_MAPS_CLIENT_ID만 ncpKeyId 파라미터로 사용
 *   (NEXT_PUBLIC_ 프리픽스로 노출해도 되는 유일한 값 — 도메인 화이트리스트가 보호).
 * - 네이버 지역 검색: developers.naver.com 별도 체계.
 *   헤더 X-Naver-Client-Id / X-Naver-Client-Secret.
 */
const envSchema = z.object({
  // developers.kakao.com — 카카오 로컬/모빌리티 REST API (KakaoAK 헤더)
  KAKAO_REST_API_KEY: z.string().min(1).optional(),

  // developers.naver.com — 지역(Local) 검색 API
  NAVER_LOCAL_CLIENT_ID: z.string().min(1).optional(),
  NAVER_LOCAL_CLIENT_SECRET: z.string().min(1).optional(),

  // NCP Maps (신규 상품) — Geocoding/Directions 등 REST API
  NCP_MAPS_CLIENT_ID: z.string().min(1).optional(),
  NCP_MAPS_CLIENT_SECRET: z.string().min(1).optional(),

  // 한국관광공사 TourAPI 4.0 — data.go.kr serviceKey (Decoding 버전을 넣을 것)
  TOUR_API_KEY: z.string().min(1).optional(),

  // data.go.kr 계정 단일 인증키 (TOUR_API_KEY와 같은 값). 한국철도공사
  // 편의시설(B551457) 등 비-관광 data.go.kr 서비스 공용.
  DATA_GO_KR_API_KEY: z.string().min(1).optional(),

  // Deepgram — 음성 받아쓰기(STT) 서버 키 (Authorization: Token 헤더)
  DEEPGRAM_API_KEY: z.string().min(1).optional(),

  // 서울 열린데이터광장 일반 인증키 — 따릉이(bikeList) 등 openapi.seoul.go.kr 계열
  SEOUL_OPEN_DATA_KEY: z.string().min(1).optional(),

  // 서울 열린데이터광장 "실시간 데이터 인증키" — 일반키와 별도 계열.
  // 지하철 실시간 도착(swopenapi.seoul.go.kr) 전용. 일반키로는 ERROR-338.
  SEOUL_SUBWAY_REALTIME_KEY: z.string().min(1).optional(),

  // ODsay 대중교통 길찾기 — api.odsay.com apiKey (서버 전용).
  // ⚠ URL 인코딩된 키를 재인코딩하면 깨짐(data.go.kr serviceKey와 동형).
  ODSAY_API_KEY: z.string().min(1).optional(),

  // 행안부 도로명주소 검색 API — business.juso.go.kr confmKey (서버 전용).
  // 검색 응답에 공식 영문 주소(engAddr)·우편번호(zipNo)가 포함된다.
  JUSO_CONFM_KEY: z.string().min(1).optional(),

  // openapi.sk.com: Tmap 보행자(+자동차) 경로안내, appKey 헤더 인증.
  TMAP_APP_KEY: z.string().min(1).optional(),

  // Google Gemini — 채팅 function-calling 엔진(서버 전용). 유료 API.
  GEMINI_API_KEY: z.string().min(1).optional(),

  // Perplexity Search — 채팅 실시간 웹 검색 도구(서버 전용). 유료 API.
  // dodo-planet과 공유 키. 키 없으면 search_web 도구 미노출(회귀 0).
  PERPLEXITY_API_KEY: z.string().min(1).optional(),

  // 네이버 지도 앱 딥링크의 appname 파라미터 (필수 권장)
  NEXT_PUBLIC_APP_IDENTIFIER: z.string().default("space.dodoplanet.gildongmu"),
});

export const env = envSchema.parse({
  KAKAO_REST_API_KEY: process.env.KAKAO_REST_API_KEY,
  NAVER_LOCAL_CLIENT_ID: process.env.NAVER_LOCAL_CLIENT_ID,
  NAVER_LOCAL_CLIENT_SECRET: process.env.NAVER_LOCAL_CLIENT_SECRET,
  NCP_MAPS_CLIENT_ID: process.env.NCP_MAPS_CLIENT_ID,
  NCP_MAPS_CLIENT_SECRET: process.env.NCP_MAPS_CLIENT_SECRET,
  TOUR_API_KEY: process.env.TOUR_API_KEY,
  DATA_GO_KR_API_KEY: process.env.DATA_GO_KR_API_KEY,
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
  SEOUL_OPEN_DATA_KEY: process.env.SEOUL_OPEN_DATA_KEY,
  SEOUL_SUBWAY_REALTIME_KEY: process.env.SEOUL_SUBWAY_REALTIME_KEY,
  ODSAY_API_KEY: process.env.ODSAY_API_KEY,
  JUSO_CONFM_KEY: process.env.JUSO_CONFM_KEY,
  TMAP_APP_KEY: process.env.TMAP_APP_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
  NEXT_PUBLIC_APP_IDENTIFIER: process.env.NEXT_PUBLIC_APP_IDENTIFIER,
});

/** 카카오 로컬 API 사용 가능 여부 */
export function hasKakaoKey(): boolean {
  return Boolean(env.KAKAO_REST_API_KEY);
}

/** 네이버 지역 검색 API 사용 가능 여부 */
export function hasNaverLocalKeys(): boolean {
  return Boolean(env.NAVER_LOCAL_CLIENT_ID && env.NAVER_LOCAL_CLIENT_SECRET);
}

/** NCP Maps REST API 사용 가능 여부 */
export function hasNcpMapsKeys(): boolean {
  return Boolean(env.NCP_MAPS_CLIENT_ID && env.NCP_MAPS_CLIENT_SECRET);
}

/** TourAPI(한국관광공사) 사용 가능 여부 */
export function hasTourApiKey(): boolean {
  return Boolean(env.TOUR_API_KEY);
}

/** data.go.kr 공용 인증키(철도공사 편의시설 등) 사용 가능 여부 */
export function hasDataGoKrKey(): boolean {
  return Boolean(env.DATA_GO_KR_API_KEY);
}

/** Deepgram 음성 받아쓰기(STT) 사용 가능 여부 */
export function hasDeepgramKey(): boolean {
  return Boolean(env.DEEPGRAM_API_KEY);
}

/** 서울 열린데이터광장(따릉이 등) 사용 가능 여부 */
export function hasSeoulOpenDataKey(): boolean {
  return Boolean(env.SEOUL_OPEN_DATA_KEY);
}

/** 서울 지하철 실시간 도착(swopenapi) 사용 가능 여부 */
export function hasSeoulSubwayRealtimeKey(): boolean {
  return Boolean(env.SEOUL_SUBWAY_REALTIME_KEY);
}

/** ODsay 대중교통 길찾기 사용 가능 여부 */
export function hasOdsayKey(): boolean {
  return Boolean(env.ODSAY_API_KEY);
}

/** 행안부 도로명주소 검색 API 사용 가능 여부 */
export function hasJusoKey(): boolean {
  return Boolean(env.JUSO_CONFM_KEY);
}

/** Tmap 보행자 경로안내 사용 가능 여부 */
export function hasTmapKey(): boolean {
  return Boolean(env.TMAP_APP_KEY);
}

/** 도보 길찾기 사용 가능 여부 — 기본 카카오, 폴백 Tmap. 어느 한쪽 키만 있어도 동작. */
export function hasWalkRouteKey(): boolean {
  return hasKakaoKey() || hasTmapKey();
}

/** 자동차 경로 브리핑(ko) 사용 가능 여부 — 기본 Tmap, 폴백 카카오모빌리티. 어느 한쪽 키만 있어도 동작. */
export function hasCarRouteKey(): boolean {
  return hasTmapKey() || hasKakaoKey();
}

/** Google Gemini 채팅 API 사용 가능 여부 */
export function hasGeminiKey(): boolean {
  return !!env.GEMINI_API_KEY;
}

/** Perplexity 웹 검색 API 사용 가능 여부 */
export function hasPerplexityKey(): boolean {
  return !!env.PERPLEXITY_API_KEY;
}
