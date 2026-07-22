import { z } from "zod";
import { isInKorea } from "@/lib/deeplink";

/**
 * "위도,경도" 문자열 → {lat,lng} (WGS84), 자동차·대중교통·도보 길찾기 라우트 공용.
 * 세 라우트에 동일 스키마가 3중복돼 있던 것을 공용화(2026-07-22 백로그).
 */
export const coordSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "좌표 형식은 '위도,경도'")
  .transform((raw) => {
    const [lat, lng] = raw.split(",").map(Number);
    return { lat, lng };
  })
  .refine((c) => isInKorea(c.lat, c.lng), "좌표가 한반도 권역을 벗어남");
