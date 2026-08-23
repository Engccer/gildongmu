import { isInKorea } from "../coverage";
import { haversineMeters } from "../geo";
import seed from "../data/osm-walk-nodes.json";

/**
 * OSM 보행 노드(횡단보도·점자블록) 정적 seed 조회 provider(서버 전용, 동기).
 *
 * 종전 Overpass 실시간 호출을 대체한다(spec `2026-08-16-osm-walk-nodes-seed-design.md`).
 * 그 호출은 프로덕션에서 429·504로 실패했고, 110m 격자 타일이라 걸어가면 신규 타일이
 * 연속되므로 캐시가 가장 안 듣는 사용자가 보행자였다.
 *
 * seed 생성·가드(태그 매핑·국외 유입·지역 결손)는 scripts/build-osm-walk-nodes.mjs의
 * 빌드 타임 책임이고 여기서는 순수 조회만 한다. audio-signals.ts와 같은 골격이다.
 *
 * ⚠ 이 seed는 OpenStreetMap 유래(ODbL)라 **국내 공공데이터 seed와 파일을 합치지 않는다**
 * — 병합본은 Derivative Database가 되어 공공데이터 국외 반출 제한과 충돌한다.
 * 병합은 런타임(walk-infra.ts)에서만 한다.
 */

interface SeedShape {
  meta: { source: string; license: string; counts: { total: number } };
  nodes: Array<[number, number, number, number]>;
}

const SEED = seed as unknown as SeedShape;

export interface RawWalkFeature {
  /** "node/123": 물리 객체 식별자. seed는 node만 담으므로 접두는 고정이다. */
  osmId: string;
  lat: number;
  lng: number;
  /** highway=crossing */
  crossing: boolean;
  /** crossing=traffic_signals→yes / uncontrolled·unmarked→no / 그 외·없음→unknown */
  crossingSignal: "yes" | "no" | "unknown";
  /** tactile_paving=yes */
  tactilePaving: boolean;
  /** 비-crossing tactile 노드의 호스트, 판별 가능할 때만. */
  hostFeature?: "busStop" | "subwayEntrance";
}

const SIGNAL_BY_BITS: Record<number, RawWalkFeature["crossingSignal"]> = {
  0: "no",
  1: "yes",
  2: "unknown",
};

const HOST_BY_BITS: Record<number, RawWalkFeature["hostFeature"]> = {
  1: "busStop",
  2: "subwayEntrance",
};

/**
 * seed 노드 `[id, lat, lng, flags]` → RawWalkFeature.
 *
 * ⚠ 알 수 없는 비트 조합(신호 3·호스트 3)은 조용히 무시하지 말고 **미상으로 강등**한다.
 * seed와 로더가 함께 움직여야 하는 구간이므로, 어긋났을 때 그럴듯한 거짓값이 아니라
 * "모른다"가 나와야 한다.
 */
function decodeNode(node: [number, number, number, number]): RawWalkFeature {
  const [id, lat, lng, flags] = node;
  const hostFeature = HOST_BY_BITS[(flags >> 4) & 3];
  return {
    osmId: `node/${id}`,
    lat,
    lng,
    crossing: (flags & 1) === 1,
    crossingSignal: SIGNAL_BY_BITS[(flags >> 1) & 3] ?? "unknown",
    tactilePaving: ((flags >> 3) & 1) === 1,
    ...(hostFeature ? { hostFeature } : {}),
  };
}

/**
 * 반경 내 보행 노드. 제공 지역 밖이면 **null**(=서비스 미제공)이고, 안이면 0건도
 * 빈 배열이다 — "그 근처에 없다"와 "그 지역은 자료가 없다"를 뭉개지 않는다.
 */
export function findWalkFeaturesNear(
  lat: number,
  lng: number,
  radiusMeters: number,
): RawWalkFeature[] | null {
  // 제공 지역 판정 정본은 coverage.ts의 국경 폴리곤이다(E19 — 사각형은 그 안의
  // 프리필터이고, 판정에 쓰면 후쿠오카가 0건 ok로 통과한다).
  if (!isInKorea(lat, lng)) return null;

  // 도(°) 박스 프리필터 후 haversine. 전국 79,574건 전수 스캔이 0.19ms(실측).
  const degLat = radiusMeters / 111_000;
  const degLng = degLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));

  const found: RawWalkFeature[] = [];
  for (const node of SEED.nodes) {
    if (Math.abs(node[1] - lat) > degLat) continue;
    if (Math.abs(node[2] - lng) > degLng) continue;
    if (haversineMeters(lat, lng, node[1], node[2]) > radiusMeters) continue;
    found.push(decodeNode(node));
  }
  return found;
}

/** seed 메타(출처·라이선스·건수). 테스트·진단용. */
export function osmWalkSeedMeta(): SeedShape["meta"] {
  return SEED.meta;
}
