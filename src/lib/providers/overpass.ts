/**
 * OSM Overpass provider: 횡단보도(`highway=crossing`)·점자블록(`tactile_paving=yes`)
 * 노드 조회(spec §2-C, V1은 way/area 미포함).
 *
 * provider는 OSM 원시 태그를 정규화된 shape로 변환할 뿐, 거리·방위는 계산하지
 * 않는다(서비스 계층이 타일 anchor 캐시 위에서 사용자 실좌표로 계산, §2-D).
 * 서비스·라우트·컴포넌트·채팅은 OSM 원시 필드를 모른다(provider 격리).
 */

/**
 * 클라이언트 abort 예산. 실측(2026-08-13, 서울 타일 6곳)에서 성공은 1.4~3.9초에
 * 끝났고 실패(429·504)만 7.9~8.9초까지 끌었다. 종전 12초는 그 실패를 전부 기다린
 * 뒤 "조회 실패"를 냈다 — 기다림이 정보를 주지 않는 최악의 조합이다.
 */
export const OVERPASS_CLIENT_TIMEOUT_MS = 6_000;
/**
 * Overpass 자체 timeout(초). 클라이언트 abort보다 **먼저** 끝나야 우리가 버린
 * 질의를 상류가 계속 붙들지 않는다(그 낭비가 429를 부른다). 그래서 값을 따로
 * 두지 않고 클라이언트 예산에서 유도한다 — 두 값이 갈리는 것이 조용한 결함이다.
 */
const SERVER_TIMEOUT_S = Math.floor(OVERPASS_CLIENT_TIMEOUT_MS / 1000) - 1;
const USER_AGENT = "gildongmu/1.0 (+https://gildongmu.dodoplanet.space)";

/**
 * 실패의 대응 범위. 소비자가 쿨다운 범위를 정하는 데 쓴다.
 * - `upstream`: 우리 IP·상류 전체 상태(비200 전부). 다른 타일을 더 두드리면 악화된다.
 * - `tile`: 이 질의 자체의 문제(부분 응답·malformed). 다른 타일은 정상일 수 있다.
 *
 * ⚠ 실측(2026-08-13)으로 확정한 경계다: 같은 타일이 `[timeout:5]`로도 11.33초 뒤
 * 23건을 **정상 반환**했다. Overpass의 timeout은 *실행* 시간에만 걸리고 슬롯 대기는
 * 포함하지 않으므로, 긴 대기는 질의 비용이 아니라 대기 큐 포화다. 그래서 클라이언트
 * 타임아웃(scope 없음)은 타일이 아니라 upstream 신호로 다뤄야 한다.
 */
export type OverpassFailureScope = "upstream" | "tile";

/**
 * 실패가 실어 보내는 판정 정보. 메시지 문자열 파싱 금지 — 문구가 바뀌면 조용히 깨진다.
 * `overpassScope`가 없는 실패(fetch abort·네트워크 오류)는 소비자가 `upstream`으로
 * 취급한다(위 주석의 대기 큐 근거).
 */
export interface OverpassError extends Error {
  overpassScope?: OverpassFailureScope;
  /** 비200일 때의 HTTP status(진단용). 범위 판정은 `overpassScope`가 정본. */
  overpassStatus?: number;
}

function overpassError(message: string, scope: OverpassFailureScope, status?: number): OverpassError {
  const error = new Error(message) as OverpassError;
  error.overpassScope = scope;
  if (status !== undefined) error.overpassStatus = status;
  return error;
}

/** crossing 태그 값 → crossingSignal 고정 매핑(spec §2-C, 임의 확장 금지). 표 밖·없음은 unknown. */
const CROSSING_SIGNAL_MAP: Record<string, "yes" | "no"> = {
  traffic_signals: "yes",
  uncontrolled: "no",
  unmarked: "no",
};

export interface RawWalkFeature {
  /** "node/123": 물리 객체 dedup 키. */
  osmId: string;
  lat: number;
  lng: number;
  /** highway=crossing */
  crossing: boolean;
  /** crossing=traffic_signals→yes / uncontrolled·unmarked→no / 그 외·없음→unknown */
  crossingSignal: "yes" | "no" | "unknown";
  /** tactile_paving=yes */
  tactilePaving: boolean;
  /** 비-crossing tactile 노드의 호스트, 판별 가능할 때만(spec §2-C). */
  hostFeature?: "busStop" | "subwayEntrance";
}

interface OverpassElement {
  type?: string;
  id?: number | string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/**
 * Overpass elements → RawWalkFeature[]. 같은 osmId가 두 번 나오면(union 질의가
 * 같은 물리 노드를 두 갈래에서 각각 매치) 병합한다. 플래그는 OR, crossingSignal은
 * unknown이 아닌 값을 우선(둘 다 같은 실물 노드의 동일 태그이므로 충돌 없음이 정상).
 * 좌표는 node면 el.lat/el.lon, way/relation 폴백은 el.center.
 */
export function normalizeOverpassElements(elements: unknown[]): RawWalkFeature[] {
  const byId = new Map<string, RawWalkFeature>();
  for (const raw of elements) {
    const el = raw as OverpassElement;
    const lat = typeof el.lat === "number" ? el.lat : el.center?.lat;
    const lng = typeof el.lon === "number" ? el.lon : el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    const osmId = `${el.type ?? "node"}/${el.id}`;
    const tags = el.tags ?? {};
    const isCrossing = tags.highway === "crossing";
    const crossingSignal: RawWalkFeature["crossingSignal"] = tags.crossing
      ? (CROSSING_SIGNAL_MAP[tags.crossing] ?? "unknown")
      : "unknown";
    const tactilePaving = tags.tactile_paving === "yes";
    let hostFeature: RawWalkFeature["hostFeature"];
    if (!isCrossing && tactilePaving) {
      if (tags.highway === "bus_stop") hostFeature = "busStop";
      else if (tags.railway === "subway_entrance") hostFeature = "subwayEntrance";
    }

    const existing = byId.get(osmId);
    if (existing) {
      existing.crossing = existing.crossing || isCrossing;
      if (crossingSignal !== "unknown") existing.crossingSignal = crossingSignal;
      existing.tactilePaving = existing.tactilePaving || tactilePaving;
      existing.hostFeature = existing.hostFeature ?? hostFeature;
      continue;
    }
    byId.set(osmId, { osmId, lat, lng, crossing: isCrossing, crossingSignal, tactilePaving, hostFeature });
  }
  return Array.from(byId.values());
}

function overpassUrl(): string {
  // 실호출 게이트의 강제 실패 검증용 env 우회 허용(spec §2-C). 일반 서버 키
  // 스키마(src/lib/env.ts)와 달리 raw process.env를 직접 읽는다.
  return process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
}

/**
 * anchor 좌표(사용자 정밀 좌표 아님, 서비스 계층 타일 anchor) 반경 내 횡단보도·
 * 점자블록 노드 조회. 부분 응답(`remark` 필드)·malformed(elements 비배열)·
 * 비200은 모두 throw한다: 200 위장 성공을 차단한다(spec §2-C).
 */
export async function fetchWalkFeaturesTile(
  anchorLat: number,
  anchorLng: number,
  radiusMeters: number,
  opts: { signal?: AbortSignal } = {},
): Promise<RawWalkFeature[]> {
  const around = `around:${radiusMeters},${anchorLat},${anchorLng}`;
  const query =
    `[out:json][timeout:${SERVER_TIMEOUT_S}];` +
    `(node(${around})[highway=crossing];node(${around})[tactile_paving=yes];);` +
    `out tags center;`;

  const timeoutSignal = AbortSignal.timeout(OVERPASS_CLIENT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(overpassUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });
  if (!res.ok) throw overpassError(`Overpass HTTP ${res.status}`, "upstream", res.status);
  const raw = (await res.json()) as { remark?: string; elements?: unknown };
  if (raw.remark) throw overpassError(`Overpass 부분 응답: ${raw.remark}`, "tile");
  if (!Array.isArray(raw.elements)) throw overpassError("Overpass elements 비정상 응답", "tile");
  return normalizeOverpassElements(raw.elements);
}
