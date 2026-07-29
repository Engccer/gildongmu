import { z } from "zod";

/**
 * "위도,경도" 문자열 → {lat,lng} (WGS84), 자동차·대중교통·도보 길찾기 라우트 공용.
 * 세 라우트에 동일 스키마가 3중복돼 있던 것을 공용화(2026-07-22 백로그).
 *
 * 한국 커버리지 판정(isInKorea)은 이 스키마의 책임이 아니다 — 여기는 형식·전지구
 * 범위만 검증하고, 각 라우트 핸들러가 parse 성공 직후 isInKorea로 200
 * {outOfCoverage:true} 마커를 반환한다(2026-07-29, nearby 10종과 동일 계약).
 */
export const coordSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "좌표 형식은 '위도,경도'")
  .transform((raw) => {
    const [lat, lng] = raw.split(",").map(Number);
    return { lat, lng };
  })
  .refine((c) => Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180, "좌표 범위 오류");
