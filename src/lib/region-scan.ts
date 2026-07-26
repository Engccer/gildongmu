import type { Coord } from "./types";
import { coordToRegion } from "./providers/kakao-address";

/**
 * 좌표 반경 → 시도(광역자치단체) 합집합.
 *
 * 응급의료정보 병의원 목록(`getHsptlMdcncListInfoInqire`)은 **시도+시군구** 축이라
 * "N km 반경"을 직접 받지 못한다. 이 모듈이 반경을 행정 축으로 번역하고, 반경
 * 필터링 자체는 받아온 뒤 코드가 Haversine으로 한다.
 *
 * **시군구가 아니라 시도로 훑는 이유**: `Q1`(시군구)은 생략 가능하고 시도 전량이
 * 한 축으로 오므로(실측 서울 3,081·경기 3,929), 시군구 경계를 넘나드는 문제
 * (강동 사용자에게 송파·광진이 필요)가 통째로 사라진다. 시도 인접표·중심좌표
 * seed 같은 유지보수 자산이 필요 없다 — 다시 도입하지 말 것.
 *
 * ⚠ 샘플 좌표를 타일 anchor로 반올림하지 않는다. 경계 근처에서 1km 반올림이
 * 시도 판정을 뒤집을 수 있고, 카카오 로컬 쿼터(일 30만, 공유)에 비해 요청당
 * 9회는 무시할 수준이라 캐시를 위해 정확도를 거래할 이유가 없다.
 */

const EARTH_RADIUS_METERS = 6_371_000;

/** 8방위(bearing.ts 관용구 동형). 4방위는 두 방위 사이 시도를 놓친다. */
const SAMPLE_BEARINGS_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** 중심에서 방위각 bearing으로 meters 이동한 좌표(구면 대원 이동). */
export function destinationPoint(
  origin: Coord,
  bearingDeg: number,
  meters: number,
): Coord {
  const angular = meters / EARTH_RADIUS_METERS;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

/** 중심 + 반경 8방위 = 9점. 반경이 0 이하면 중심 한 점만. */
export function regionSamplePoints(
  origin: Coord,
  radiusMeters: number,
): Coord[] {
  if (!(radiusMeters > 0)) return [origin];
  return [
    origin,
    ...SAMPLE_BEARINGS_DEG.map((b) => destinationPoint(origin, b, radiusMeters)),
  ];
}

/**
 * "서울특별시 강동구 길동" → "서울특별시". 첫 공백 앞 토큰이 시도다.
 * 빈 문자열·null이면 null(없는 값을 지어내지 않는다).
 */
export function sidoOf(regionName: string | null | undefined): string | null {
  const first = (regionName ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * 좌표 반경이 걸치는 시도 목록(중복 제거, 중심 시도가 항상 첫 원소).
 *
 * 샘플 하나가 실패해도 나머지는 살린다(부분 성공 보존) — 바다·국경 밖 좌표는
 * 카카오가 빈 결과를 주는 것이 정상이고, 그걸 전체 실패로 승격하면 해안가
 * 사용자가 기능을 통째로 잃는다. 전멸이면 빈 배열이고 호출부가 3-state로 다룬다.
 */
export async function scanSidos(
  origin: Coord,
  radiusMeters: number,
): Promise<string[]> {
  const points = regionSamplePoints(origin, radiusMeters);
  const settled = await Promise.allSettled(
    points.map((p) => coordToRegion(p)),
  );

  const sidos: string[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const sido = sidoOf(result.value);
    if (sido && !sidos.includes(sido)) sidos.push(sido);
  }
  return sidos;
}
