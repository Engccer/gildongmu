import type { BusStop } from "./types";
import { fetchTagoNearby } from "./providers/tago-bus";
import { fetchSeoulNearby } from "./providers/seoul-bus";

/** 좌표 4자리(약 11m) 중복 판정 키 — en 장소병합과 동일 기준. */
function coordKey(s: BusStop): string {
  return `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
}

/**
 * TAGO + 서울 정류소를 병합한다. 좌표 4자리가 같으면 같은 정류소로 보고
 * 거리가 더 가까운 쪽만 남긴다(경계의 동일 정류소 중복 방지). 거리순 정렬 후 상위 5.
 */
export function mergeBusStops(tago: BusStop[], seoul: BusStop[]): BusStop[] {
  const byKey = new Map<string, BusStop>();
  for (const s of [...tago, ...seoul]) {
    const k = coordKey(s);
    const prev = byKey.get(k);
    if (!prev || s.distanceMeters < prev.distanceMeters) byKey.set(k, s);
  }
  return [...byKey.values()]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);
}

/**
 * 좌표 근접 정류소 — TAGO·서울 병렬 병합 진입점.
 * 둘 다 실패해야 throw, 하나라도 성공이면 그 실데이터를 보존(가짜 폴백 금지).
 * 서울은 TAGO 미수록(서울 TOPIS 별도 운영)이라 강동·서울 경계에서 둘이 함께 잡힌다.
 */
export async function fetchNearbyBusStops(lat: number, lng: number): Promise<BusStop[]> {
  const [tagoR, seoulR] = await Promise.allSettled([
    fetchTagoNearby(lat, lng),
    fetchSeoulNearby(lat, lng),
  ]);
  if (tagoR.status === "rejected" && seoulR.status === "rejected") {
    throw new Error(`버스 정보 조회 실패: tago=${tagoR.reason}; seoul=${seoulR.reason}`);
  }
  const tago = tagoR.status === "fulfilled" ? tagoR.value : [];
  const seoul = seoulR.status === "fulfilled" ? seoulR.value : [];
  return mergeBusStops(tago, seoul);
}
