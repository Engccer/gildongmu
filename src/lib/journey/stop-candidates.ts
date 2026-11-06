/** 정류장 후보 검색의 클라이언트 경로(fetch) — 서버 조회 본체는 `stop-search.ts`. */
import type { Coord, JourneyStopSearchResult } from "@/lib/types";
import { haversineMeters } from "@/lib/geo";

/** 정류장 이름 검색이 받는 길이(라우트 `/api/route/journey/stops`와 같은 범위). */
const STOP_QUERY_MIN = 2;
const STOP_QUERY_MAX = 30;
/** 후보는 역·정류장 각각 상위 5(끝점 칸 미니 검색과 같은 폭). */
export const CANDIDATE_LIMIT = 5;

/** 정류장 후보 한 줄(E70-e) — 역 칸과 입구 칸(E77)이 같은 줄을 쓴다. */
export type StopCandidate = { name: string; lat: number; lng: number; distance: number | null; key: string };

/**
 * 정류장 이름 검색(`/api/route/journey/stops`) — 역 칸과 입구 칸(E77 spec §3.1)의 공용 경로. 기준 좌표(출발·도착 칸의 확정
 * 좌표 중 있는 것)가 없거나 게이트가 거짓이거나 길이가 범위 밖이면 부르지 않는다(`wanted: false`). 거리는 첫 기준 좌표에서 잰다.
 * `failed`는 요청 실패와 응답 안의 일부 원천 실패를 함께 본다(0건과 실패를 뭉개지 않는다, 3-state).
 */
export async function searchStopCandidates(
  q: string,
  stopRefs: { origin: Coord | null; dest: Coord | null },
  canSearchStops: boolean,
): Promise<{ wanted: boolean; stops: StopCandidate[]; failed: boolean; truncated: boolean }> {
  const refs = [stopRefs.origin, stopRefs.dest].filter((c): c is Coord => c !== null);
  const wanted = canSearchStops && refs.length > 0 && q.length >= STOP_QUERY_MIN && q.length <= STOP_QUERY_MAX;
  if (!wanted) return { wanted, stops: [], failed: false, truncated: false };
  const params = new URLSearchParams({ q });
  if (stopRefs.origin) params.set("origin", `${stopRefs.origin.lat},${stopRefs.origin.lng}`);
  if (stopRefs.dest) params.set("dest", `${stopRefs.dest.lat},${stopRefs.dest.lng}`);
  let body: JourneyStopSearchResult | { outOfCoverage: true };
  try {
    const r = await fetch(`/api/route/journey/stops?${params}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    body = (await r.json()) as JourneyStopSearchResult | { outOfCoverage: true };
  } catch {
    return { wanted, stops: [], failed: true, truncated: false };
  }
  const result = "stops" in body ? body : null;
  const reference = refs[0];
  const stops = (result?.stops ?? []).slice(0, CANDIDATE_LIMIT).map((s, i) => ({
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    distance: haversineMeters(reference.lat, reference.lng, s.lat, s.lng),
    key: `${s.source}:${s.stopNo ?? i}:${s.lat},${s.lng}`,
  }));
  return { wanted, stops, failed: result?.failed === true, truncated: result?.truncated === true };
}
