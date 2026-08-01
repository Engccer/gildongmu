import seed from "./providers/data/congestion-areas.json";

/**
 * 서울 실시간 도시데이터 핫스팟 영역 판정 — **순수 함수**(네트워크 없음).
 *
 * 서울시는 121개 핫스팟의 혼잡도를 주지만 **영역 경계를 공개하지 않는다.**
 * 대신 전체 `citydata` 응답이 그 영역을 구성하는 지하철역·버스정류장을
 * 좌표와 함께 주므로, 그 지점들이 영역의 범위를 정의한다(seed는
 * `scripts/build-congestion-areas.mjs`가 굳힌다).
 *
 * ⚠ **중심-반경 원으로 판정하지 않는다.** 영역 크기가 0m부터 1,872m까지
 * 제각각이라(중앙값 475m) 잠실 관광특구의 원은 무관한 주택가를 통째로
 * 삼킨다. 판정은 **최근접 구성 지점까지의 거리**로 한다.
 *
 * 임계값 300m의 근거(스펙 §1-4): 매칭 대상 8지점은 전부 ≤120m, 비대상은
 * 전부 ≥676m로 완전 분리된다. 서울 격자에서 300m는 8.9%를 핫스팟으로
 * 판정하고(750m는 21.5%로 과잉) 150~500m 전 구간이 같은 답을 낸다.
 *
 * 판정과 실시간 호출(`providers/seoul-congestion.ts`)을 나눈 이유: 판정은
 * 좌표만 있으면 되는 순수 함수라 fixture로 회귀를 잡을 수 있고, 섞으면
 * 임계값 회귀를 네트워크 뒤에 숨기게 된다.
 */

export const MATCH_RADIUS_METERS = 300;

export interface CongestionAreaSeed {
  /** 서울시 영역 코드(`POI014`). 실시간 조회 키. */
  code: string;
  name: string;
  /** 구성 지점 중심 [lat, lng] — 중첩 시 우선순위 판정에만 쓴다. */
  c: [number, number];
  /** 구성 지점 [lat, lng][] — 영역 범위의 정의. */
  pts: [number, number][];
}

export interface CongestionArea {
  code: string;
  name: string;
}

const AREAS = (seed as { areas: CongestionAreaSeed[] }).areas;

/** 테스트·진단용 seed 접근자. 런타임 코드는 `findCongestionArea`만 쓴다. */
export function listCongestionAreas(): CongestionAreaSeed[] {
  return AREAS;
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 좌표가 속한 핫스팟 영역. 없으면 null(오류가 아니라 "여기는 핫스팟이
 * 아니다" — 서울의 91%가 여기 해당한다).
 *
 * 후보가 여럿이면 **중심이 가장 가까운** 영역 하나를 고른다. 잠실역
 * 1번 출구는 잠실 관광특구·잠실롯데타워·잠실역 셋 다 7m로 동률이지만
 * 중심 거리는 78m < 527m < 893m라 가장 국소적인 "잠실역"이 답이다.
 */
export function findCongestionArea(lat: number, lng: number): CongestionArea | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let best: CongestionAreaSeed | null = null;
  let bestCentroid = Infinity;

  for (const area of AREAS) {
    let nearest = Infinity;
    for (const [plat, plng] of area.pts) {
      const d = haversineMeters(lat, lng, plat, plng);
      if (d < nearest) nearest = d;
      if (nearest <= 0) break;
    }
    if (nearest > MATCH_RADIUS_METERS) continue;

    const centroid = haversineMeters(lat, lng, area.c[0], area.c[1]);
    if (centroid < bestCentroid) {
      best = area;
      bestCentroid = centroid;
    }
  }

  return best ? { code: best.code, name: best.name } : null;
}
