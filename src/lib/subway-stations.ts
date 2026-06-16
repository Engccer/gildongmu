import type { StationMeta, SubwayStation } from "./types";
import { haversineMeters } from "./geo";
import { normalizeStationName } from "./station-match";
import rawStations from "./data/subway-stations.json";

/**
 * 전국 도시철도역 메타(A3) 조회 — 정적 seed 기반 순수 로직.
 *
 * React/Next 비의존(dodo-planet 이식성). seed는 연 1회 갱신 XLSX를
 * scripts/build-subway-stations.py로 변환한 src/lib/data/subway-stations.json.
 * 1,098개 역, 서버 전용 import 권장(클라이언트 번들 제외).
 *
 * A1(역 교통약자 시설)·A2(실시간 도착)의 받침대:
 * - matchStationsByName: 역명 → 표준 메타(영문역명·노선·좌표) 정확매칭
 * - nearestStations: 좌표 근접 역 식별
 *
 * 순수 로직(데이터 주입형)과 seed 바인딩 공개 API를 분리해, 순수 로직은
 * 작은 fixture로 결정적으로 테스트하고 seed 갱신과 독립시킨다.
 */

/** seed JSON을 도메인 타입으로 — 빌드 시점 변환 산출물이라 형태가 보증됨. */
const STATIONS = rawStations as SubwayStation[];

/**
 * 역명 정확매칭 — 접미사("역"/"station") 무시 정규화 후 동일한 역만.
 * 환승역은 노선마다 별도 레코드라 여러 행을 반환한다.
 * 부분일치는 배제한다("강동" 검색이 "강동구청"을 끌어오지 않음 — A1 교훈).
 */
export function matchStationsByName(
  stations: SubwayStation[],
  query: string,
): SubwayStation[] {
  const target = normalizeStationName(query);
  if (!target) return [];
  return stations.filter((s) => normalizeStationName(s.name) === target);
}

/** nearestStations 옵션. */
export interface NearestOptions {
  /** 이 반경(m) 밖은 제외. 기본 제한 없음. */
  radiusMeters?: number;
  /** 최대 개수. */
  limit?: number;
  /** 역명당 최근접 1행만(환승역 중복 제거). */
  dedupeByName?: boolean;
}

/**
 * 좌표 근접 역을 거리순으로 — 각 역에 distanceMeters를 부여한 새 배열.
 * 입력 배열·원소를 변형하지 않는다(순수). 거리·정렬은 deterministic.
 */
export function nearestStations(
  stations: SubwayStation[],
  lat: number,
  lng: number,
  opts: NearestOptions = {},
): Array<SubwayStation & { distanceMeters: number }> {
  let withDist = stations
    .map((s) => ({
      ...s,
      distanceMeters: haversineMeters(lat, lng, s.lat, s.lng),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  if (opts.radiusMeters !== undefined) {
    withDist = withDist.filter((s) => s.distanceMeters <= opts.radiusMeters!);
  }
  if (opts.dedupeByName) {
    const seen = new Set<string>();
    withDist = withDist.filter((s) => {
      const key = normalizeStationName(s.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (opts.limit !== undefined) {
    withDist = withDist.slice(0, opts.limit);
  }
  return withDist;
}

/**
 * 같은 역명의 여러 노선 레코드를 하나의 표시용 메타로 집계.
 * 환승역은 노선이 여럿이라 lines로 묶는다(중복 제거·원문 순서 보존).
 * 매칭 행이 없으면 null(미커버 역 → 호출부 graceful degrade).
 */
export function summarizeStation(
  stations: SubwayStation[],
): StationMeta | null {
  if (stations.length === 0) return null;
  const head = stations[0];
  const lines: string[] = [];
  for (const s of stations) {
    if (!lines.includes(s.lineName)) lines.push(s.lineName);
  }
  const meta: StationMeta = {
    name: head.name,
    nameEn: head.nameEn,
    lines,
    isTransfer: stations.some((s) => s.isTransfer),
    operator: head.operator,
  };
  const hanja = stations.find((s) => s.nameHanja)?.nameHanja;
  if (hanja) meta.nameHanja = hanja;
  return meta;
}

/** seed 바인딩: 역명으로 표준 메타 조회(영문역명·노선·좌표 받침대). */
export function findStationsByName(query: string): SubwayStation[] {
  return matchStationsByName(STATIONS, query);
}

/** seed 바인딩: 역명으로 표시용 메타 1건 집계(없으면 null). */
export function findStationMeta(query: string): StationMeta | null {
  return summarizeStation(findStationsByName(query));
}

/** seed 바인딩: 좌표 근접 역 조회. */
export function findStationsNear(
  lat: number,
  lng: number,
  opts?: NearestOptions,
): Array<SubwayStation & { distanceMeters: number }> {
  return nearestStations(STATIONS, lat, lng, opts);
}
