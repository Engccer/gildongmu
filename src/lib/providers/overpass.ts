/**
 * OSM Overpass provider — 횡단보도(`highway=crossing`)·점자블록(`tactile_paving=yes`)
 * 노드 조회(spec §2-C, V1은 way/area 미포함).
 *
 * provider는 OSM 원시 태그를 정규화된 shape로 변환할 뿐, 거리·방위는 계산하지
 * 않는다(서비스 계층이 타일 anchor 캐시 위에서 사용자 실좌표로 계산, §2-D) —
 * 서비스·라우트·컴포넌트·채팅은 OSM 원시 필드를 모른다(provider 격리).
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const USER_AGENT = "gildongmu/1.0 (+https://gildongmu.vercel.app)";

/** crossing 태그 값 → crossingSignal 고정 매핑(spec §2-C, 임의 확장 금지). 표 밖·없음은 unknown. */
const CROSSING_SIGNAL_MAP: Record<string, "yes" | "no"> = {
  traffic_signals: "yes",
  uncontrolled: "no",
  unmarked: "no",
};

export interface RawWalkFeature {
  /** "node/123" — 물리 객체 dedup 키. */
  osmId: string;
  lat: number;
  lng: number;
  /** highway=crossing */
  crossing: boolean;
  /** crossing=traffic_signals→yes / uncontrolled·unmarked→no / 그 외·없음→unknown */
  crossingSignal: "yes" | "no" | "unknown";
  /** tactile_paving=yes */
  tactilePaving: boolean;
  /** 비-crossing tactile 노드의 호스트 — 판별 가능할 때만(spec §2-C). */
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
 * 같은 물리 노드를 두 갈래에서 각각 매치) 병합한다 — 플래그는 OR, crossingSignal은
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
  // 실호출 게이트의 강제 실패 검증용 env 우회 허용(spec §2-C) — 일반 서버 키
  // 스키마(src/lib/env.ts)와 달리 raw process.env를 직접 읽는다.
  return process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
}

/**
 * anchor 좌표(사용자 정밀 좌표 아님, 서비스 계층 타일 anchor) 반경 내 횡단보도·
 * 점자블록 노드 조회. 부분 응답(`remark` 필드)·malformed(elements 비배열)·
 * 비200은 모두 throw — 200 위장 성공을 차단한다(spec §2-C).
 */
export async function fetchWalkFeaturesTile(
  anchorLat: number,
  anchorLng: number,
  radiusMeters: number,
  opts: { signal?: AbortSignal } = {},
): Promise<RawWalkFeature[]> {
  const around = `around:${radiusMeters},${anchorLat},${anchorLng}`;
  const query =
    `[out:json][timeout:10];` +
    `(node(${around})[highway=crossing];node(${around})[tactile_paving=yes];);` +
    `out tags center;`;

  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
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
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const raw = (await res.json()) as { remark?: string; elements?: unknown };
  if (raw.remark) throw new Error(`Overpass 부분 응답: ${raw.remark}`);
  if (!Array.isArray(raw.elements)) throw new Error("Overpass elements 비정상 응답");
  return normalizeOverpassElements(raw.elements);
}
