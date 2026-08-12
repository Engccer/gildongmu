import { findAudioSignalsNear } from "./providers/audio-signals";
import type { NearbyAudioSignals } from "./providers/audio-signals";
import { fetchWalkFeaturesTile } from "./providers/overpass";
import type { OverpassError, RawWalkFeature } from "./providers/overpass";
import type { CompassDirection } from "./geo/bearing";
import { bearingDegrees, bearingToCompass8 } from "./geo/bearing";
import { haversineMeters } from "./geo";

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
  /** 300m 필터 후, crossing+비-crossing tactile 합집합 cap 전 실개수. */
  totalCount: number;
  /** cap 후 features.length(crossing 10 + 비-crossing tactile 10 합집합, 최대 20). */
  listedCount: number;
  /** crossing·tactile 두 projection 중 하나라도 cap 10에 잘렸으면 true. */
  truncated: boolean;
  /** crossing projection cap 전 실개수(spec §2-E·§3 "횡단보도 N곳 중 가까운 M곳"). */
  crossingTotal: number;
  /** 비-crossing tactile projection cap 전 실개수(§3 "점자블록 N곳 중 가까운 M곳"). */
  tactileTotal: number;
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
/**
 * 인스턴스 전역 Overpass 호출 예산(공개 인스턴스 예의, spec §2-D·§6 절대 상한 아님).
 * 실측(2026-08-13)에서 1.2초 간격 4번째 호출이 이미 HTTP 429를 받았다 — 종전 30은
 * 공용 인스턴스가 참아 주는 수준보다 훨씬 높아 예산이 보호 역할을 하지 못했다.
 * 보행자 한 명이 필요한 양은 분당 1회 미만이다(110m 격자 ÷ 보행 속도).
 */
export const OVERPASS_BUDGET_PER_MINUTE = 10;
const OVERPASS_BUDGET_WINDOW_MS = 60_000;
/**
 * 실패 쿨다운. 성공 캐시(1시간)보다 훨씬 짧아 일시 장애를 영구 실패로 굳히지 않되,
 * 걸어가며 타일을 연달아 넘는 사용자의 재시도 폭주를 끊을 만큼은 길다.
 */
export const OVERPASS_FAILURE_COOLDOWN_MS = 60_000;

/**
 * 타일 fetch 결과를 지속 캐시할 래퍼(예: Next `unstable_cache`). src/lib는 Next
 * 비의존이 항구 규칙이라(dodo-planet 이식성), 캐시 구현은 Next 쪽(소비 라우트)이
 * `configureWalkInfraTileCache`로 주입한다. 미구성 시 캐시 없이 직접 fetch.
 */
export type TileCacheWrapper = (
  fetcher: () => Promise<RawWalkFeature[]>,
  key: string,
) => Promise<RawWalkFeature[]>;

let tileCache: TileCacheWrapper | null = null;

/** Next 런타임(라우트)이 지속 캐시 구현을 주입한다. 멱등 — 재호출 시 덮어씀. */
export function configureWalkInfraTileCache(wrapper: TileCacheWrapper): void {
  tileCache = wrapper;
}

// 모듈 스코프 single-flight(동일 타일 동시 요청 dedup) + 분당 전역 호출 카운터.
const inFlightTiles = new Map<string, Promise<RawWalkFeature[]>>();
let budgetWindowStart = 0;
let budgetCount = 0;
// 실패 쿨다운. 성공은 주입된 지속 캐시가 맡고 여기엔 실패만 기록한다(3-state 불변식
// 유지 — 쿨다운 중 응답은 종전과 같은 `error`이고 "0건"으로 위장하지 않는다).
let upstreamCooldownUntil = 0;
const tileCooldownUntil = new Map<string, number>();

/** 테스트 전용. in-flight Map·전역 카운터·쿨다운·주입된 캐시를 리셋해 테스트 간 상태 누수를 막는다. */
export function __resetWalkInfraForTest(): void {
  inFlightTiles.clear();
  budgetWindowStart = 0;
  budgetCount = 0;
  upstreamCooldownUntil = 0;
  tileCooldownUntil.clear();
  tileCache = null;
}

/**
 * 실패를 쿨다운에 기록한다. 범위는 provider가 실은 `overpassScope`가 정한다.
 * `tile`(부분 응답·malformed)만 타일별이고 **나머지는 전역이 기본값**이다 — scope가
 * 없는 실패(클라이언트 타임아웃·네트워크 오류)는 그 타일이 무겁다는 뜻이 아니라
 * 우리 IP가 대기 큐에 밀렸다는 뜻이므로(근거는 `overpass.ts`의 `OverpassFailureScope`
 * 주석 실측) 다른 타일을 더 두드리면 악화된다.
 */
function recordTileFailure(key: string, error: unknown, now: number): void {
  if ((error as OverpassError | null)?.overpassScope === "tile") {
    tileCooldownUntil.set(key, now + OVERPASS_FAILURE_COOLDOWN_MS);
    return;
  }
  upstreamCooldownUntil = now + OVERPASS_FAILURE_COOLDOWN_MS;
}

/** 쿨다운 중이면 사유를 반환한다(호출 없이 즉시 실패). */
function cooldownReason(key: string, now: number): string | null {
  if (now < upstreamCooldownUntil) return "overpass 상류 쿨다운";
  const until = tileCooldownUntil.get(key);
  if (until !== undefined && now < until) return "overpass 타일 실패 쿨다운";
  return null;
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
 * 타일 anchor 좌표로 Overpass를 호출한다. Next 런타임이 주입한 지속 캐시
 * (unstable_cache)가 있으면 사용하고, 없으면 직접 fetch(단발 스크립트·비-Next
 * 이식 환경). 지속 캐시에는 성공만 담긴다(unstable_cache는 throw를 저장하지 않음).
 * 실패는 이 모듈의 쿨다운(`recordTileFailure`)이 짧게 억제한다 — 종전처럼 매 요청
 * 재시도하면 걸어가며 타일을 넘는 사용자가 상류 레이트 리밋을 스스로 유발한다.
 * single-flight·전역 예산은 별도 유지.
 */
function cachedFetchTile(anchorLat: number, anchorLng: number, cacheKey: string): Promise<RawWalkFeature[]> {
  const fetcher = () => fetchWalkFeaturesTile(anchorLat, anchorLng, TILE_RADIUS_METERS);
  return tileCache ? tileCache(fetcher, cacheKey) : fetcher();
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
    const now = Date.now();
    const cooldown = cooldownReason(key, now);
    if (cooldown) throw new Error(cooldown);
    if (!consumeOverpassBudget(now)) {
      throw new Error(`overpass 전역 호출 한도 초과(분당 ${OVERPASS_BUDGET_PER_MINUTE}회)`);
    }
    try {
      return await cachedFetchTile(anchorLat, anchorLng, `walk-tile:${key}`);
    } catch (error) {
      recordTileFailure(key, error, Date.now());
      throw error;
    }
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
    crossingTotal: crossingGroup.length,
    tactileTotal: tactileGroup.length,
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
