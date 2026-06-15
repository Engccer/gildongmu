import type { Coord, Place } from "./types";

/**
 * 좌표 기하 유틸 (deterministic — React/Next 비의존, 순수 함수).
 *
 * Haversine 거리와 "현재 위치 기준 가까운 순 정렬"을 담당한다. 거리 계산·정렬은
 * 같은 입력에 같은 정답이 정의상 보장되는 deterministic 작업이므로 코드로 잠그고
 * 테스트로 검증한다(위치 획득이라는 비결정적 I/O와 분리).
 */

/** 두 WGS84 좌표 간 대원거리(m). */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * 현재 위치(origin)에서 가까운 순으로 장소를 정렬하고, 각 장소에
 * `distanceMeters`를 부여한 새 배열을 반환한다.
 *
 * - 순수 함수: 입력 배열·원소를 변형하지 않는다(spread로 복제).
 * - 안정 정렬: 동일 거리는 입력 순서를 보존한다(ES2019+ Array.sort 안정성).
 * - 좌표가 비유한(NaN 등)인 장소는 거리를 Infinity로 둬 맨 뒤로 보낸다 —
 *   정렬 비교가 NaN으로 깨지는 것을 막는다(deterministic 보장).
 */
export function sortPlacesByDistance(places: Place[], origin: Coord): Place[] {
  return places
    .map((p) => {
      const d =
        Number.isFinite(p.lat) && Number.isFinite(p.lng)
          ? haversineMeters(origin.lat, origin.lng, p.lat, p.lng)
          : Number.POSITIVE_INFINITY;
      return { ...p, distanceMeters: d };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}
