import { findAudioSignalsNear } from "./providers/audio-signals";
import type { NearbyAudioSignals } from "./providers/audio-signals";
import { findWalkFeaturesNear } from "./providers/osm-walk-nodes";
import type { RawWalkFeature } from "./providers/osm-walk-nodes";
import { findOsmJunctionsNear } from "./providers/osm-walk-junctions";
import { findSeoulWalkNetworkNear } from "./providers/seoul-walk-network";
import type { SeoulWalkNetworkNear } from "./providers/seoul-walk-network";
import type { WalkJunction } from "./walk-junction";
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
  | { status: "unsupported"; reason: "outsideSeoul" | "outsideKorea" | "outsideSeed" }
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
  /** 나들이 노드 옵트인(`nodes=1`)에만. OSM 도로망 교차점 — 서울 bbox 밖은 unsupported. */
  osmJunctions?: SourceStatus<{ junctions: WalkJunction[] }>;
  /** 나들이 노드 옵트인(`nodes=1`)에만. 서울 도보 네트워크 횡단보도·교차점 — 서울 밖은 unsupported. */
  seoulNetwork?: SourceStatus<SeoulWalkNetworkNear>;
}

// 사용자 실좌표 기준 300m 필터(spec §2-D).
const USER_RADIUS_METERS = 300;
// crossing·비-crossing tactile 각 projection의 cap(합집합 최대 20건).
const GROUP_CAP = 10;

/**
 * 좌표 옵트인(`coords=1`, 나들이 횡단보도 예고 — spec 2026-09-26 §6.3)의 상한. 걷는 사람은 조회점에서
 * 최대 100m(재조회 간격)까지 멀어지므로 "조회점에서 가까운 10곳"으로는 그 사람 앞의 횡단보도가
 * 잘린다. 횡단보도는 300m 안 전부에 가깝게, 음향신호기 지점은 횡단보도와 짝지을 만큼 싣는다.
 * OSM feature는 원래 `lat`·`lng`를 싣는다(원시 feature 전개) — 옵트인이 바꾸는 것은 상한과 음향신호기 좌표다.
 */
const COORDS_CROSSING_CAP = 60;
const COORDS_AUDIO_SITE_CAP = 40;

/**
 * 나들이 노드 옵트인(`nodes=1`, E58 ①③ spec 2026-09-26 §6.6)의 원천별 상한. 반경은 300m 그대로다 — 조회점에서
 * 재조회 간격(50m)만큼 걸어도 앞 20m 교차점은 반경 안이다. 서울 골목 격자에서 300m 안 교차점은 원천마다
 * 수십~백여 곳이라 상한은 잘림 방지 여유다.
 */
const NODES_JUNCTION_CAP = 150;
const NODES_CROSSWALK_CAP = 60;

export interface WalkInfraOptions {
  /** 나들이용 좌표 옵트인. 미지정·false는 종전 계약과 바이트 동일. */
  coords: boolean;
  /** 나들이 교차점·서울망 횡단보도 옵트인. false면 두 필드를 싣지 않는다(종전 계약과 바이트 동일). */
  nodes: boolean;
}

/**
 * seed 원시 feature → 사용자 실좌표 기준 거리·방위 부가, 300m 필터, 거리순 정렬,
 * crossing·비-crossing tactile 각 projection cap 10 후 합집합(spec §2-C·§2-E).
 * 데이터원이 정적 seed로 바뀌어도 이 표현 계층은 그대로다 — 거리·방위·cap은
 * 데이터가 어디서 왔는지와 무관한 관심사다.
 */
function projectOsmData(
  rawFeatures: RawWalkFeature[],
  lat: number,
  lng: number,
  crossingCap: number = GROUP_CAP,
): OsmWalkData {
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

  const cappedCrossing = crossingGroup.slice(0, crossingCap);
  const cappedTactile = tactileGroup.slice(0, GROUP_CAP);
  const features = [...cappedCrossing, ...cappedTactile].sort((a, b) => a.distanceMeters - b.distanceMeters);

  return {
    features,
    totalCount: withDistance.length,
    listedCount: features.length,
    truncated: crossingGroup.length > crossingCap || tactileGroup.length > GROUP_CAP,
    crossingTotal: crossingGroup.length,
    tactileTotal: tactileGroup.length,
  };
}

async function loadAudioSignals(
  lat: number,
  lng: number,
  coords: boolean,
): Promise<SourceStatus<NearbyAudioSignals>> {
  const result = coords
    ? findAudioSignalsNear(lat, lng, USER_RADIUS_METERS, { withCoords: true, maxSites: COORDS_AUDIO_SITE_CAP })
    : findAudioSignalsNear(lat, lng);
  if (result === null) return { status: "unsupported", reason: "outsideSeoul" };
  return { status: "ok", data: result };
}

async function loadOsm(lat: number, lng: number, coords: boolean): Promise<SourceStatus<OsmWalkData>> {
  const rawFeatures = findWalkFeaturesNear(lat, lng, USER_RADIUS_METERS);
  // seed 범위 밖은 "0건"이 아니라 미제공이다 — 시각장애 사용자는 화면으로 그 차이를
  // 확인할 수 없으므로 "이 근처에 횡단보도가 없다"로 읽히면 위험한 오해가 된다.
  if (rawFeatures === null) return { status: "unsupported", reason: "outsideKorea" };
  return {
    status: "ok",
    data: projectOsmData(rawFeatures, lat, lng, coords ? COORDS_CROSSING_CAP : GROUP_CAP),
  };
}

/**
 * 좌표 → 보행 인프라 상태 계약. 두 소스를 병렬 실행하고 서로 독립적으로 강등한다
 * (한 소스 실패가 다른 소스를 죽이지 않는다). loadAudioSignals·loadOsm은 동기·비동기
 * throw를 구분하지 않고 그대로 던지며, allSettled가 유일한 포착 지점이다. 동기
 * throw(findAudioSignalsNear 모킹 실패 등)도 rejected로 정상 포착된다.
 */
async function loadOsmJunctions(lat: number, lng: number): Promise<SourceStatus<{ junctions: WalkJunction[] }>> {
  const junctions = await findOsmJunctionsNear(lat, lng, USER_RADIUS_METERS, NODES_JUNCTION_CAP);
  // seed 범위(서울 bbox — 경기 일부 포함이라 "서울 밖"이 아니다) 밖은 "교차로 없음"이 아니라 미제공이다.
  if (junctions === null) return { status: "unsupported", reason: "outsideSeed" };
  return { status: "ok", data: { junctions } };
}

async function loadSeoulNetwork(lat: number, lng: number): Promise<SourceStatus<SeoulWalkNetworkNear>> {
  const data = await findSeoulWalkNetworkNear(lat, lng, USER_RADIUS_METERS, {
    crosswalks: NODES_CROSSWALK_CAP,
    junctions: NODES_JUNCTION_CAP,
  });
  if (data === null) return { status: "unsupported", reason: "outsideSeoul" };
  return { status: "ok", data };
}

function settled<T>(result: PromiseSettledResult<SourceStatus<T>>, label: string): SourceStatus<T> {
  if (result.status === "fulfilled") return result.value;
  console.error(`[walk-infra] ${label} 조회 실패:`, result.reason);
  return { status: "error" };
}

/** 노드 옵트인의 두 원천(서로 독립 강등 — 한쪽 seed 실패가 다른 쪽을 죽이지 않는다). */
async function loadNodeSources(
  lat: number,
  lng: number,
): Promise<Pick<WalkInfrastructure, "osmJunctions" | "seoulNetwork">> {
  const [junctions, seoul] = await Promise.allSettled([loadOsmJunctions(lat, lng), loadSeoulNetwork(lat, lng)]);
  return { osmJunctions: settled(junctions, "OSM 교차점"), seoulNetwork: settled(seoul, "서울 도보 네트워크") };
}

export async function getWalkInfrastructure(
  lat: number,
  lng: number,
  options?: WalkInfraOptions,
): Promise<WalkInfrastructure> {
  const coords = options?.coords ?? false;
  const nodes = options?.nodes ?? false;
  const [[audioSignalsResult, osmResult], nodeSources] = await Promise.all([
    Promise.allSettled([loadAudioSignals(lat, lng, coords), loadOsm(lat, lng, coords)]),
    // 옵트인이 아니면 키 자체를 싣지 않는다(종전 응답과 바이트 동일 — 채팅·CLI·내 주변·스토어 앱).
    nodes ? loadNodeSources(lat, lng) : Promise.resolve({}),
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
    ...nodeSources,
  };
}
