import { findAudioSignalsNear } from "./providers/audio-signals";
import type { NearbyAudioSignals } from "./providers/audio-signals";
import { findWalkFeaturesNear } from "./providers/osm-walk-nodes";
import type { RawWalkFeature } from "./providers/osm-walk-nodes";
import type { CompassDirection } from "./geo/bearing";
import { bearingDegrees, bearingToCompass8 } from "./geo/bearing";
import { haversineMeters } from "./geo";

/**
 * 음향신호기(서울 seed)+OSM 보행 인프라(횡단보도·점자블록)를 단일 상태 계약으로
 * 조립하는 오케스트레이션 계층(spec §1). 라우트·채팅 도구는 이 함수만 호출하고
 * provider(audio-signals·osm-walk-nodes)를 직접 호출하지 않는다. 같은 사실이 소비자마다
 * 다른 상태로 갈라지는 것을 구조적으로 차단한다.
 */

export type SourceStatus<T> =
  | { status: "ok"; data: T }
  | { status: "unsupported"; reason: "outsideSeoul" | "outsideKorea" }
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

// 사용자 실좌표 기준 300m 필터(spec §2-D).
const USER_RADIUS_METERS = 300;
// crossing·비-crossing tactile 각 projection의 cap(합집합 최대 20건).
const GROUP_CAP = 10;

/**
 * seed 원시 feature → 사용자 실좌표 기준 거리·방위 부가, 300m 필터, 거리순 정렬,
 * crossing·비-crossing tactile 각 projection cap 10 후 합집합(spec §2-C·§2-E).
 * 데이터원이 정적 seed로 바뀌어도 이 표현 계층은 그대로다 — 거리·방위·cap은
 * 데이터가 어디서 왔는지와 무관한 관심사다.
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
  const rawFeatures = findWalkFeaturesNear(lat, lng, USER_RADIUS_METERS);
  // seed 범위 밖은 "0건"이 아니라 미제공이다 — 시각장애 사용자는 화면으로 그 차이를
  // 확인할 수 없으므로 "이 근처에 횡단보도가 없다"로 읽히면 위험한 오해가 된다.
  if (rawFeatures === null) return { status: "unsupported", reason: "outsideKorea" };
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
