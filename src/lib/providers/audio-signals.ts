import type { CompassDirection } from "../geo/bearing";
import { bearingDegrees, bearingToCompass8 } from "../geo/bearing";
import { haversineMeters } from "../geo";
import seed from "../data/audio-signals.json";

/**
 * 서울시 음향신호기(OA-15543) 정적 seed 조회 provider(서버 전용, 동기).
 *
 * seed는 scripts/build-audio-signals.mjs가 EPSG:5186→WGS84 변환해 생성한
 * (lat,lng) 목록뿐, 좌표계·golden 가드는 빌드 타임 책임이고 여기서는 순수 조회만 한다.
 * 서울 bbox 밖은 "0기"가 아니라 null(서비스 미제공, spec §2-E unsupported)로
 * 구분해 "정보 없음"과 "제공 안 함"을 뭉개지 않는다.
 */

const SEED = seed as unknown as { meta: { baseDate: string }; signals: Array<[number, number]> };

// 빌드 스크립트와 동일 상수(scripts/build-audio-signals.mjs). 회귀 시 함께 갱신.
const SEOUL_BBOX = { latMin: 37.4, latMax: 37.72, lngMin: 126.73, lngMax: 127.2 };

const DEFAULT_RADIUS_METERS = 300;
const MAX_SITES = 5; // 한 지주 다기기 반복 낭독 방지(spec §2-B)

export interface AudioSignalSite {
  distanceMeters: number;
  bearing: CompassDirection;
  deviceCount: number;
}

export interface NearbyAudioSignals {
  /** 반경 내 기기 총수, sites(최대 5)에 잘리기 전 값(spec §2-B "12기" 오해 방지). */
  deviceCount: number;
  sites: AudioSignalSite[];
  baseDate: string;
}

/**
 * 좌표 toFixed(4)(≈11m 격자) 키로 지점 군집. 같은 격자에 묶인 원시 점 중
 * origin에 가장 가까운 점을 대표 좌표로 삼아 distance/bearing을 계산한다
 * (임의 첫 점이 아니라 "최근접점 기준": 배열 순서 의존 제거).
 */
export function clusterSites(
  points: Array<[number, number]>,
  origin: { lat: number; lng: number },
): AudioSignalSite[] {
  const groups = new Map<string, Array<[number, number]>>();
  for (const p of points) {
    const key = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }

  const sites: AudioSignalSite[] = [];
  for (const group of groups.values()) {
    let nearest = group[0];
    let nearestDist = haversineMeters(origin.lat, origin.lng, nearest[0], nearest[1]);
    for (const p of group.slice(1)) {
      const d = haversineMeters(origin.lat, origin.lng, p[0], p[1]);
      if (d < nearestDist) {
        nearest = p;
        nearestDist = d;
      }
    }
    sites.push({
      distanceMeters: Math.round(nearestDist),
      bearing: bearingToCompass8(bearingDegrees(origin.lat, origin.lng, nearest[0], nearest[1])),
      deviceCount: group.length,
    });
  }

  return sites.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, MAX_SITES);
}

function inSeoulBbox(lat: number, lng: number): boolean {
  return (
    lat >= SEOUL_BBOX.latMin && lat <= SEOUL_BBOX.latMax &&
    lng >= SEOUL_BBOX.lngMin && lng <= SEOUL_BBOX.lngMax
  );
}

/**
 * 반경 내 음향신호기 존재 여부(경량, 도보 경로 주석용). 서울 bbox 밖은 false —
 * 소비자(walk-route)가 positive-only 표기라 "미제공"과 "없음" 구분이 필요 없다
 * (findAudioSignalsNear의 null=unsupported 구분과 다른 계약).
 * 성능: 도(°) 박스 프리필터로 haversine 호출을 근접 후보로 줄인다(seed 16,822 × step 수십).
 */
export function hasAudioSignalNear(lat: number, lng: number, radiusMeters: number): boolean {
  if (!inSeoulBbox(lat, lng)) return false;
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return SEED.signals.some(
    ([slat, slng]) =>
      Math.abs(slat - lat) <= latDelta &&
      Math.abs(slng - lng) <= lngDelta &&
      haversineMeters(lat, lng, slat, slng) <= radiusMeters,
  );
}

/** 좌표 반경 내 음향신호기 조회. 서울 bbox 밖은 null(unsupported), 안이면 0기도 ok. */
export function findAudioSignalsNear(
  lat: number,
  lng: number,
  radiusMeters: number = DEFAULT_RADIUS_METERS,
): NearbyAudioSignals | null {
  if (!inSeoulBbox(lat, lng)) {
    return null;
  }
  const origin = { lat, lng };
  const within = SEED.signals.filter(
    ([slat, slng]) => haversineMeters(lat, lng, slat, slng) <= radiusMeters,
  );
  return {
    deviceCount: within.length,
    sites: clusterSites(within, origin),
    baseDate: SEED.meta.baseDate,
  };
}
