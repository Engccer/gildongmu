import { unstable_cache } from "next/cache";
import { findAudioSignalsNear } from "./providers/audio-signals";
import type { NearbyAudioSignals } from "./providers/audio-signals";
import { fetchWalkFeaturesTile } from "./providers/overpass";
import type { RawWalkFeature } from "./providers/overpass";
import type { CompassDirection } from "./geo/bearing";
import { bearingDegrees, bearingToCompass8, haversineMeters } from "./geo/bearing";

/**
 * 음향신호기(서울 seed)+OSM 보행 인프라(횡단보도·점자블록)를 단일 상태 계약으로
 * 조립하는 오케스트레이션 계층(spec §1). 라우트·채팅 도구는 이 함수만 호출하고
 * provider(audio-signals·overpass)를 직접 호출하지 않는다. 같은 사실이 소비자마다
 * 다른 상태로 갈라지는 것을 구조적으로 차단한다.
 */

export type SourceStatus<T> =
  | { status: "ok"; data: T }
  | { status: "unsupported"; reason: "outsideSeoul" }
  | { status: "error" };

export type WalkFeature = RawWalkFeature & { distanceMeters: number; bearing: CompassDirection };

export interface OsmWalkData {
  features: WalkFeature[];
  /** 300m 필터 후, projection별 cap 전 실개수(spec §2-E "cap 전 실개수"). */
  totalCount: number;
  /** cap 후 features.length(crossing 10 + 비-crossing tactile 10 합집합, 최대 20). */
  listedCount: number;
  /** crossing·tactile 두 projection 중 하나라도 cap 10에 잘렸으면 true. */
  truncated: boolean;
}

export interface WalkInfrastructure {
  audioSignals: SourceStatus<NearbyAudioSignals>;
  osm: SourceStatus<OsmWalkData>;
}

// 타일 anchor 반경(사용자 300m + anchor 오프셋 버퍼 100m, 서버 고정값·spec §2-D).
const TILE_RADIUS_METERS = 400;
// 사용자 실좌표 기준 최종 300m 필터(spec §2-D).
const USER_RADIUS_METERS = 300;
// crossing·비-crossing tactile 각 projection의 cap(합집합 최대 20건).
const GROUP_CAP = 10;
const CACHE_REVALIDATE_SECONDS = 3600;
// 인스턴스 전역 Overpass 호출 예산(공개 인스턴스 예의, spec §2-D·§6 절대 상한 아님).
const OVERPASS_BUDGET_PER_MINUTE = 30;
const OVERPASS_BUDGET_WINDOW_MS = 60_000;

// 모듈 스코프 single-flight(동일 타일 동시 요청 dedup) + 분당 전역 호출 카운터.
const inFlightTiles = new Map<string, Promise<RawWalkFeature[]>>();
let budgetWindowStart = 0;
let budgetCount = 0;

/** 테스트 전용. in-flight Map·전역 카운터를 리셋해 테스트 간 상태 누수를 막는다. */
export function __resetWalkInfraForTest(): void {
  inFlightTiles.clear();
  budgetWindowStart = 0;
  budgetCount = 0;
}

function consumeOverpassBudget(now: number): boolean {
  if (now - budgetWindowStart >= OVERPASS_BUDGET_WINDOW_MS) {
    budgetWindowStart = now;
    budgetCount = 0;
  }
  if (budgetCount >= OVERPASS_BUDGET_PER_MINUTE) return false;
  budgetCount += 1;
  return true;
}

/** 사용자 좌표 → 타일 anchor(toFixed(3), 약 110m 그리드). */
function tileAnchor(lat: number, lng: number): { key: string; anchorLat: number; anchorLng: number } {
  const latStr = lat.toFixed(3);
  const lngStr = lng.toFixed(3);
  return { key: `${latStr}:${lngStr}`, anchorLat: Number(latStr), anchorLng: Number(lngStr) };
}

/**
 * 타일 anchor 좌표로 Overpass를 호출하고 결과를 1시간 캐시한다. 성공만 캐시되고
 * (unstable_cache는 throw를 저장하지 않음) 실패는 매 요청 재시도된다(spec §2-D).
 */
function cachedFetchTile(anchorLat: number, anchorLng: number, cacheKey: string): Promise<RawWalkFeature[]> {
  return unstable_cache(
    () => fetchWalkFeaturesTile(anchorLat, anchorLng, TILE_RADIUS_METERS),
    [cacheKey],
    { revalidate: CACHE_REVALIDATE_SECONDS },
  )();
}

/**
 * 같은 타일 동시 요청을 single-flight로 묶고, 실제 새 fetch 시도에만 전역 예산을
 * 소비한다(같은 타일에 묶인 대기자는 예산을 소비하지 않는다).
 */
async function fetchTileWithBudget(lat: number, lng: number): Promise<RawWalkFeature[]> {
  const { key, anchorLat, anchorLng } = tileAnchor(lat, lng);
  const inFlight = inFlightTiles.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    if (!consumeOverpassBudget(Date.now())) {
      throw new Error("overpass 전역 호출 한도 초과(분당 30회)");
    }
    return cachedFetchTile(anchorLat, anchorLng, `walk-tile:${key}`);
  })();

  inFlightTiles.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlightTiles.delete(key);
  }
}

/**
 * 타일 원시 feature → 사용자 실좌표 기준 거리·방위 부가, 300m 필터, 거리순 정렬,
 * crossing·비-crossing tactile 각 projection cap 10 후 합집합(spec §2-C·§2-E).
 * 같은 타일을 공유하는 다른 사용자에게 남의 거리·방위가 재사용되지 않도록
 * 이 계산은 항상 호출자의 실좌표(lat, lng)로 매 요청 재수행한다.
 */
function projectOsmData(rawFeatures: RawWalkFeature[], lat: number, lng: number): OsmWalkData {
  const withDistance: WalkFeature[] = rawFeatures
    .map((feature) => ({
      ...feature,
      distanceMeters: Math.round(haversineMeters(lat, lng, feature.lat, feature.lng)),
      bearing: bearingToCompass8(bearingDegrees(lat, lng, feature.lat, feature.lng)),
    }))
    .filter((feature) => feature.distanceMeters <= USER_RADIUS_METERS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const crossingGroup = withDistance.filter((feature) => feature.crossing);
  const tactileGroup = withDistance.filter((feature) => !feature.crossing && feature.tactilePaving);

  const cappedCrossing = crossingGroup.slice(0, GROUP_CAP);
  const cappedTactile = tactileGroup.slice(0, GROUP_CAP);
  const features = [...cappedCrossing, ...cappedTactile].sort((a, b) => a.distanceMeters - b.distanceMeters);

  return {
    features,
    totalCount: withDistance.length,
    listedCount: features.length,
    truncated: crossingGroup.length > GROUP_CAP || tactileGroup.length > GROUP_CAP,
  };
}

async function loadAudioSignals(lat: number, lng: number): Promise<SourceStatus<NearbyAudioSignals>> {
  const result = findAudioSignalsNear(lat, lng);
  if (result === null) return { status: "unsupported", reason: "outsideSeoul" };
  return { status: "ok", data: result };
}

async function loadOsm(lat: number, lng: number): Promise<SourceStatus<OsmWalkData>> {
  const rawFeatures = await fetchTileWithBudget(lat, lng);
  return { status: "ok", data: projectOsmData(rawFeatures, lat, lng) };
}

/**
 * 좌표 → 보행 인프라 상태 계약. 두 소스를 병렬 실행하고 서로 독립적으로 강등한다
 * (한 소스 실패가 다른 소스를 죽이지 않는다). loadAudioSignals·loadOsm은 동기·비동기
 * throw를 구분하지 않고 그대로 던지며, allSettled가 유일한 포착 지점이다. 동기
 * throw(findAudioSignalsNear 모킹 실패 등)도 rejected로 정상 포착된다.
 */
export async function getWalkInfrastructure(lat: number, lng: number): Promise<WalkInfrastructure> {
  const [audioSignalsResult, osmResult] = await Promise.allSettled([
    loadAudioSignals(lat, lng),
    loadOsm(lat, lng),
  ]);

  if (audioSignalsResult.status === "rejected") {
    console.error("[walk-infra] 음향신호기 조회 실패:", audioSignalsResult.reason);
  }
  if (osmResult.status === "rejected") {
    console.error("[walk-infra] OSM 보행 인프라 조회 실패:", osmResult.reason);
  }

  return {
    audioSignals: audioSignalsResult.status === "fulfilled" ? audioSignalsResult.value : { status: "error" },
    osm: osmResult.status === "fulfilled" ? osmResult.value : { status: "error" },
  };
}
