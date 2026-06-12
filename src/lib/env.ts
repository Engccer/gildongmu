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
  // developers.naver.com — 지역(Local) 검색 API
  NAVER_LOCAL_CLIENT_ID: z.string().min(1).optional(),
  NAVER_LOCAL_CLIENT_SECRET: z.string().min(1).optional(),

  // NCP Maps (신규 상품) — Geocoding/Directions 등 REST API
  NCP_MAPS_CLIENT_ID: z.string().min(1).optional(),
  NCP_MAPS_CLIENT_SECRET: z.string().min(1).optional(),

  // 네이버 지도 앱 딥링크의 appname 파라미터 (필수 권장)
  NEXT_PUBLIC_APP_IDENTIFIER: z.string().default("space.dodoplanet.gildongmu"),
});

export const env = envSchema.parse({
  NAVER_LOCAL_CLIENT_ID: process.env.NAVER_LOCAL_CLIENT_ID,
  NAVER_LOCAL_CLIENT_SECRET: process.env.NAVER_LOCAL_CLIENT_SECRET,
  NCP_MAPS_CLIENT_ID: process.env.NCP_MAPS_CLIENT_ID,
  NCP_MAPS_CLIENT_SECRET: process.env.NCP_MAPS_CLIENT_SECRET,
  NEXT_PUBLIC_APP_IDENTIFIER: process.env.NEXT_PUBLIC_APP_IDENTIFIER,
});

/** 네이버 지역 검색 API 사용 가능 여부 */
export function hasNaverLocalKeys(): boolean {
  return Boolean(env.NAVER_LOCAL_CLIENT_ID && env.NAVER_LOCAL_CLIENT_SECRET);
}

/** NCP Maps REST API 사용 가능 여부 */
export function hasNcpMapsKeys(): boolean {
  return Boolean(env.NCP_MAPS_CLIENT_ID && env.NCP_MAPS_CLIENT_SECRET);
}
