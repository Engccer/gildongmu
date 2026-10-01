import { decodeJunction, nearestRows } from "../walk-junction";
import type { JunctionRow, WalkJunction } from "../walk-junction";

/**
 * 서울시 도보 네트워크(OA-21208) 정적 seed 조회(서버 전용) — 나들이 횡단보도·교차로 예고(E58 ①③, spec
 * 2026-09-26 §6.6). 출처 표시 "서울특별시 공공데이터"(`NOTICE.md`).
 *
 * seed 생성·가드는 `scripts/build-seoul-walk-network.mjs`. 횡단보도는 이미 쌍을 접은 점(한 횡단보도 = 점 하나)이다.
 * 제공 범위는 노드가 있는 0.01도 격자 칸(`cells`)이고 그 밖(경기 등)은 미제공(null) — 0건이 아니다. 사각형으로
 * 판정하면 서울 bbox 안의 경기 지역이 "횡단보도 없음"으로 거짓 통과한다.
 *
 * ⚠ 조회 때 동적 import(옵트인 밖의 요청이 4MB를 올리지 않게). ⚠ OSM seed와 파일을 합치지 않는다.
 */

interface SeedShape {
  meta: { cellDegrees: number };
  crosswalks: Array<[number, number]>;
  junctions: JunctionRow[];
  cells: number[];
}

let cached: { seed: SeedShape; cells: Set<number> } | null = null;
async function load() {
  if (!cached) {
    const seed = (await import("../data/seoul-walk-network.json")).default as unknown as SeedShape;
    cached = { seed, cells: new Set(seed.cells) };
  }
  return cached;
}

/** 빌드 스크립트 `cellKey`와 같은 식(0.01도 칸). */
export function seoulCellKey(lat: number, lng: number): number {
  return Math.floor(lat * 100) * 100_000 + Math.floor(lng * 100);
}

export interface SeoulWalkNetworkNear {
  crosswalks: Array<{ lat: number; lng: number }>;
  junctions: WalkJunction[];
}

/** 반경 안 횡단보도·교차점(가까운 순 상한). 제공 칸 밖이면 null. */
export async function findSeoulWalkNetworkNear(
  lat: number,
  lng: number,
  radiusMeters: number,
  caps: { crosswalks: number; junctions: number },
): Promise<SeoulWalkNetworkNear | null> {
  const { seed, cells } = await load();
  if (!cells.has(seoulCellKey(lat, lng))) return null;
  return {
    crosswalks: nearestRows(seed.crosswalks, lat, lng, radiusMeters, caps.crosswalks).map(([a, b]) => ({
      lat: a,
      lng: b,
    })),
    junctions: nearestRows(seed.junctions, lat, lng, radiusMeters, caps.junctions).map(decodeJunction),
  };
}
