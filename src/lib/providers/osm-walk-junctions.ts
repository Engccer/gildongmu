import { decodeJunction, nearestRows } from "../walk-junction";
import type { JunctionRow, WalkJunction } from "../walk-junction";

/**
 * OSM 도로망 교차점 정적 seed 조회(서버 전용) — 나들이 교차로 예고(E58 ①, spec 2026-09-26 §6.6).
 *
 * seed 생성·가드는 `scripts/build-osm-walk-junctions.mjs`의 책임이고 여기서는 조회만 한다.
 * seed는 **서울 bbox만** 담는다(전국 교차점은 함수 번들에 싣지 못하는 크기, 빌드 스크립트 머리말) — 그 밖은
 * 0건이 아니라 미제공(null)이다. 판정은 seed가 받은 범위(`meta.region`) 그대로다.
 *
 * ⚠ 정적 import가 아니라 **조회 때 동적 import**한다: 나들이 옵트인(`nodes=1`)이 아닌 요청(채팅·CLI·내 주변)이
 * 이 파일을 메모리에 올리지 않게 한다.
 *
 * ⚠ ODbL seed다 — 서울 도보 네트워크(공공데이터) seed와 파일을 합치지 않는다. 병합은 Kit 후보 조립에서만.
 */

interface SeedShape {
  meta: { region: { latMin: number; latMax: number; lngMin: number; lngMax: number } };
  junctions: JunctionRow[];
}

let cached: SeedShape | null = null;
async function loadSeed(): Promise<SeedShape> {
  cached ??= (await import("../data/osm-walk-junctions.json")).default as unknown as SeedShape;
  return cached;
}

/** 반경 안 교차점(가까운 순 상한). seed 범위 밖이면 null(미제공), 안이면 0건도 빈 배열. */
export async function findOsmJunctionsNear(
  lat: number,
  lng: number,
  radiusMeters: number,
  cap: number,
): Promise<WalkJunction[] | null> {
  const seed = await loadSeed();
  const r = seed.meta.region;
  if (lat < r.latMin || lat > r.latMax || lng < r.lngMin || lng > r.lngMax) return null;
  return nearestRows(seed.junctions, lat, lng, radiusMeters, cap).map(decodeJunction);
}
