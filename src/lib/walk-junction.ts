import { haversineMeters } from "./geo";

/**
 * 보행 교차점(갈림길) 공용 계약 — 나들이 교차로 예고(E58 ①, spec `2026-09-26-outing-mode-design.md` §6.6).
 *
 * 두 정적 seed(OSM `osm-walk-junctions.json`·서울 도보 네트워크 `seoul-walk-network.json`)는 같은 갈래 부호를
 * 쓴다: 정수 `kind × 36 + round(방위/10)`. 여기서 그것을 "교차점에서 그 방위로 25m 간 점"으로 푼다 — 좌우는 서버가
 * 정하지 않고 Kit `outingProject`가 그 점을 투영해 정한다(좌우의 원천은 `OutingSide` 하나, CLAUDE.md 나들이 줄).
 *
 * ⚠ 두 seed를 한 파일로 합치지 않는다(ODbL 파생 DB와 공공데이터). 이 모듈은 부호 해석만 공유한다.
 */

export type WalkBranchKind = "alley" | "road" | "path";

export interface WalkJunction {
  lat: number;
  lng: number;
  /** 갈래마다 교차점에서 그 길 쪽으로 25m 간 점. */
  branches: Array<{ lat: number; lng: number; kind: WalkBranchKind }>;
}

/** seed 행 `[lat, lng, 갈래 부호[]]`. */
export type JunctionRow = [number, number, number[]];

const KINDS: Record<number, WalkBranchKind> = { 0: "alley", 1: "road", 2: "path" };
/** 갈래 점 거리(m). seed의 `BRANCH_REACH_METERS`와 같은 값(방위를 잰 거리). */
export const BRANCH_POINT_METERS = 25;

/** 구면 근사 목적점(수십 m 거리라 평면 근사로 충분하다). */
function offset(lat: number, lng: number, bearingDeg: number, meters: number): { lat: number; lng: number } {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(rad)) / 111_320;
  const dLng = (meters * Math.sin(rad)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: Number((lat + dLat).toFixed(6)), lng: Number((lng + dLng).toFixed(6)) };
}

/** 미지 종류 부호는 버린다(seed와 로더가 어긋났을 때 그럴듯한 거짓 갈래를 만들지 않는다). */
export function decodeJunction(row: JunctionRow): WalkJunction {
  const [lat, lng, codes] = row;
  const branches: WalkJunction["branches"] = [];
  for (const code of codes) {
    const kind = KINDS[Math.floor(code / 36)];
    if (!kind) continue;
    branches.push({ ...offset(lat, lng, (code % 36) * 10, BRANCH_POINT_METERS), kind });
  }
  return { lat, lng, branches };
}

/**
 * 반경 안 행을 가까운 순으로 상한까지. `rows`는 위도 오름차순이어야 한다(두 빌드 스크립트가 정렬해 쓴다) —
 * 이분 탐색으로 위도 띠를 자른 뒤 그 띠만 훑는다(서울 seed 10만 행대).
 */
export function nearestRows<T extends [number, number, ...unknown[]]>(
  rows: T[],
  lat: number,
  lng: number,
  radiusMeters: number,
  cap: number,
): T[] {
  const degLat = radiusMeters / 111_000;
  const degLng = degLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] < lat - degLat) lo = mid + 1;
    else hi = mid;
  }
  const hits: Array<{ row: T; d: number }> = [];
  for (let i = lo; i < rows.length && rows[i][0] <= lat + degLat; i += 1) {
    const row = rows[i];
    if (Math.abs(row[1] - lng) > degLng) continue;
    const d = haversineMeters(lat, lng, row[0], row[1]);
    if (d <= radiusMeters) hits.push({ row, d });
  }
  return hits.sort((a, b) => a.d - b.d).slice(0, cap).map((h) => h.row);
}
