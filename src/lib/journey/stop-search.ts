import { haversineMeters } from "../geo";
import { coordToRegionNames } from "../providers/kakao-address";
import { searchSeoulStopsByName } from "../providers/seoul-bus";
import { fetchTagoStopsNear, searchTagoStopsByName } from "../providers/tago-bus";
import { tagoCityCodeOf } from "../tago-coverage";
import type { Coord, JourneyStopHit, JourneyStopSearchResult } from "../types";
import { busStopKey, JOURNEY_STATION_IDENTITY_M } from "./station-identity";

/**
 * 정류장 이름 검색 조립(E70-e spec §4.6). 좌표마다 검색 대상 지역(서울 TOPIS·TAGO 도시코드)을 유도하고, 대상마다
 * 이름 검색을 해 거리순으로 합친다. 외부 호출은 전부 deps라 순수하게 테스트한다.
 */

export interface StopSearchDeps {
  /** 카카오 역지오코딩. null은 「지역 없음」이 아니라 조회 실패다(HTTP 오류에도 null을 준다). */
  region: (coord: Coord) => Promise<{ province: string; city: string } | null>;
  /** 좌표 근접 TAGO 정류소의 도시코드 집합(행정구역과 제공 도시코드는 일대일이 아니다). */
  nearbyCityCodes: (coord: Coord) => Promise<string[]>;
  searchSeoul: (q: string) => Promise<JourneyStopHit[]>;
  searchTago: (cityCode: string, q: string) => Promise<{ stops: JourneyStopHit[]; truncated: boolean }>;
}

export const stopSearchDeps: StopSearchDeps = {
  region: coordToRegionNames,
  nearbyCityCodes: async (coord) => [...new Set((await fetchTagoStopsNear(coord.lat, coord.lng)).map((s) => s.cityCode))].filter(Boolean),
  searchSeoul: searchSeoulStopsByName,
  searchTago: searchTagoStopsByName,
};

const MAX_HITS = 10;

export async function searchJourneyStops(
  q: string,
  coords: Coord[],
  deps: StopSearchDeps,
): Promise<JourneyStopSearchResult> {
  let failures = 0;
  let unsearched = false;
  let truncated = false;
  const settle = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run();
    } catch {
      failures++;
      return undefined;
    }
  };

  // 좌표마다 대상 유도(병렬). 대상은 좌표 사이에서 중복 제거한다.
  const derived = await Promise.all(
    coords.map(async (coord) => {
      const targets = new Set<string>();
      const region = await settle(async () => {
        const r = await deps.region(coord);
        if (r === null) throw new Error("역지오코딩 실패");
        return r;
      });
      const fromTable = region ? tagoCityCodeOf(region.province, region.city) : null;
      if (fromTable) targets.add(fromTable);
      // 서울 밖(또는 지역을 몰라 표를 못 쓴) 좌표는 근접 정류소의 도시코드를 더한다.
      let nearOk = true;
      if (fromTable !== "seoul") {
        const near = await settle(() => deps.nearbyCityCodes(coord));
        if (near) near.forEach((c) => targets.add(c));
        else nearOk = false;
      }
      if (region && nearOk && targets.size === 0) unsearched = true;
      return targets;
    }),
  );
  const targets = new Set(derived.flatMap((t) => [...t]));

  const searched = await Promise.all(
    [...targets].map((target) =>
      settle(async () =>
        target === "seoul"
          ? { stops: await deps.searchSeoul(q), truncated: false }
          : await deps.searchTago(target, q),
      ),
    ),
  );
  // 이름 검색이 하나도 성공하지 못했는데 실패가 있으면 답한 원천이 없는 것이다(대상 유도 실패 포함). 전부 unsearched(실패 0)는 200.
  if (failures > 0 && !searched.some((r) => r !== undefined)) throw new Error("정류장 검색 전부 실패");

  const hits: JourneyStopHit[] = [];
  for (const r of searched) {
    if (!r) continue;
    hits.push(...r.stops);
    if (r.truncated) truncated = true;
  }

  const dist = (h: JourneyStopHit) => Math.min(...coords.map((c) => haversineMeters(c.lat, c.lng, h.lat, h.lng)));
  const ranked = hits.map((h) => ({ h, d: dist(h) })).sort((a, b) => a.d - b.d);
  const kept: JourneyStopHit[] = [];
  for (const { h } of ranked) {
    // 길 건너 같은 이름: 서버 판정(`busStopKey` + 500m)이 같은 곳으로 맞추므로 하나만 싣는다.
    const dup = kept.some(
      (k) =>
        busStopKey(h.name) !== "" && // 빈 키끼리는 같은 정류장이 아니다(`isSameBusStop`과 같은 술어)
        busStopKey(k.name) === busStopKey(h.name) &&
        haversineMeters(k.lat, k.lng, h.lat, h.lng) <= JOURNEY_STATION_IDENTITY_M,
    );
    if (!dup) kept.push(h);
    if (kept.length >= MAX_HITS) break;
  }

  return {
    stops: kept,
    ...(unsearched ? { unsearched: true as const } : {}),
    ...(failures > 0 ? { failed: true as const } : {}),
    ...(truncated ? { truncated: true as const } : {}),
  };
}
