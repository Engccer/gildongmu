import { roundCoord } from "./coord-round";
import type { Coord } from "./types";

/**
 * 경로 서비스 폴백 원인 로그 — Vercel 로그로 폴백률·구간을 관측한다(파서 회귀
 * 조기 발견). 좌표는 4자리 반올림(약 ±5.5m, 로그 가독성용).
 */
export function logRouteFallback(
  prefix: string,
  origin: Coord,
  dest: Coord,
  reason: unknown,
): void {
  console.warn(
    prefix,
    roundCoord(origin.lat, 4),
    roundCoord(origin.lng, 4),
    "→",
    roundCoord(dest.lat, 4),
    roundCoord(dest.lng, 4),
    reason,
  );
}
