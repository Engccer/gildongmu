/**
 * 두 WGS84 좌표 간 방위·거리 순수 함수(React/Next 비의존).
 *
 * 방위는 **북 기준 8방위**다. 사용자가 바라보는 방향(heading)은 모르므로
 * "2시 방향" 같은 정면-상대 표기를 쓰지 않는다(spec §5-4) — 방위는 본질적으로
 * 북 기준이라 오해 여지가 없다. BlindSquare식 "내 주변" 방향 안내의 정본.
 */

export type CompassDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** from→to 방위각(0~360, 북=0, 동=90). */
export function bearingDegrees(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const phi1 = toRad(fromLat);
  const phi2 = toRad(toLat);
  const dLambda = toRad(toLng - fromLng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** 방위각 → 8방위(45도 단위 반올림). 음수·360+ 정규화. */
export function bearingToCompass8(degrees: number): CompassDirection {
  const dirs: CompassDirection[] = [
    "n", "ne", "e", "se", "s", "sw", "w", "nw",
  ];
  const norm = ((degrees % 360) + 360) % 360;
  return dirs[Math.round(norm / 45) % 8];
}
