import type { Coord, Place } from "./types";

/**
 * 좌표 기하 유틸 (deterministic — React/Next 비의존, 순수 함수).
 *
 * Haversine 거리와 "현재 위치 기준 거리 주석"을 담당한다. 거리 계산은 같은
 * 입력에 같은 정답이 정의상 보장되는 deterministic 작업이므로 코드로 잠그고
 * 테스트로 검증한다(위치 획득이라는 비결정적 I/O와 분리). 정확도순 전환
 * (2026-07-20) 후 거리순 재정렬은 폐기 — distanceMeters는 표기 정보로만 쓰인다.
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
 * 정렬 없이 각 장소에 origin 기준 distanceMeters만 부여한 새 배열(순수).
 * 정확도순 전환(2026-07-20) 후 거리는 "표기 정보"이지 정렬 축이 아니다 —
 * 순서는 provider 관련도를 그대로 보존한다. 비유한 좌표는 미부여(표기 생략).
 */
export function annotateDistances(places: Place[], origin: Coord): Place[] {
  return places.map((p) =>
    Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ? { ...p, distanceMeters: haversineMeters(origin.lat, origin.lng, p.lat, p.lng) }
      : p,
  );
}

/**
 * origin 기준 거리 오름차순 새 배열(안정 정렬, 순수). ⚠ 검색 결과 본체(카카오
 * 정확도 축)에 쓰지 말 것 — 병합 검색의 "보강 꼬리"(네이버·TourAPI)처럼
 * provider 자체 순서에 근접 신호가 없는 부록 구간 전용(2026-07-21). 좌표가
 * 유한하지 않은 항목은 맨 뒤로 보낸다.
 */
export function sortByDistanceFrom(places: Place[], origin: Coord): Place[] {
  const dist = (p: Place) =>
    Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ? haversineMeters(origin.lat, origin.lng, p.lat, p.lng)
      : Number.POSITIVE_INFINITY;
  return [...places].sort((a, b) => dist(a) - dist(b));
}
