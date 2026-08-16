import { describe, it, expect } from "vitest";
import {
  normalizeElements,
  validateNodes,
  GOLDEN_ABSENT,
  GOLDEN_DENSE,
  GOLDEN_PRESENT,
  SEED_BBOX,
} from "../../../scripts/build-osm-walk-nodes.mjs";

/**
 * OSM 보행 노드 seed 빌드 스크립트 가드.
 *
 * 태그→플래그 매핑 케이스는 구 `providers/__tests__/overpass.test.ts`에서 이관했다.
 * 검증 내용은 같고 검증 대상 위치만 런타임에서 빌드 타임으로 옮겼다(spec §4.2).
 */

type Node = [number, number, number, number];

const flags = (n: Node) => n[3];
const isCrossing = (n: Node) => (n[3] & 1) === 1;
const signalBits = (n: Node) => (n[3] >> 1) & 3;
const isTactile = (n: Node) => ((n[3] >> 3) & 1) === 1;
const hostBits = (n: Node) => (n[3] >> 4) & 3;

function el(id: number, lat: number, lon: number, tags: Record<string, string>) {
  return { type: "node", id, lat, lon, tags };
}

/** 가드를 통과하는 최소 seed. 개별 가드만 골라 깨뜨리기 위한 바탕이다. */
function validNodes(): Node[] {
  const nodes: Node[] = [];
  let id = 1;
  // 전국 golden 좌표마다 crossing 1건씩(G6 충족).
  for (const p of GOLDEN_PRESENT) {
    nodes.push([id++, p.lat, p.lng, 1 | (2 << 1)]);
  }
  // 강남역 반경 안 crossing은 G7 몫으로 딱 20건만 둔다. 총량(G1·G2)은 아래 광역
  // 격자가 채운다 — 두 가드를 같은 노드 뭉치로 채우면 G7을 깨뜨리려는 변이가 G2를
  // 먼저 발화시켜 G7이 죽어 있어도 테스트가 통과한다.
  for (let i = 0; i < 20; i += 1) {
    const lat = GOLDEN_DENSE.lat + (i - 10) * 0.00002;
    nodes.push([id++, Number(lat.toFixed(5)), GOLDEN_DENSE.lng, 1 | (2 << 1)]);
  }
  // 총량용 crossing. 강남역에서 100km 넘게 떨어진 충청권 격자에 둔다 — 서울 근처에
  // 두면 격자점이 G7 반경 300m 안으로 들어와 위 20건을 지워도 밀도 가드가 발화하지
  // 않는다(첫 시도가 정확히 그렇게 실패했다).
  for (let i = 0; i < 60_000; i += 1) {
    const lat = 36.0 + (i % 300) * 0.001;
    const lng = 127.5 + Math.floor(i / 300) * 0.001;
    nodes.push([id++, Number(lat.toFixed(5)), Number(lng.toFixed(5)), 1 | (2 << 1)]);
  }
  // 점자블록(G3).
  for (let i = 0; i < 4_500; i += 1) {
    const lat = 37.5 + (i % 100) * 0.0001;
    const lng = 127.0 + Math.floor(i / 100) * 0.0001;
    nodes.push([id++, Number(lat.toFixed(5)), Number(lng.toFixed(5)), 1 << 3]);
  }
  return nodes.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
}

describe("normalizeElements: 태그 → 플래그", () => {
  it("crossing=traffic_signals는 신호 있음, uncontrolled·unmarked는 없음, 그 외는 미상", () => {
    const nodes = normalizeElements([
      el(1, 37.5, 127.0, { highway: "crossing", crossing: "traffic_signals" }),
      el(2, 37.6, 127.0, { highway: "crossing", crossing: "uncontrolled" }),
      el(3, 37.7, 127.0, { highway: "crossing", crossing: "unmarked" }),
      el(4, 37.8, 127.0, { highway: "crossing", crossing: "zebra" }),
      el(5, 37.9, 127.0, { highway: "crossing" }),
    ]) as Node[];

    const byId = new Map(nodes.map((n) => [n[0], n]));
    expect(signalBits(byId.get(1)!)).toBe(1);
    expect(signalBits(byId.get(2)!)).toBe(0);
    expect(signalBits(byId.get(3)!)).toBe(0);
    // 모르는 값과 태그 부재는 "없음"이 아니라 미상이다 — 신호가 없다고 단정하면
    // 시각장애 사용자가 신호 없는 횡단보도로 알고 건너게 된다.
    expect(signalBits(byId.get(4)!)).toBe(2);
    expect(signalBits(byId.get(5)!)).toBe(2);
    expect(nodes.every(isCrossing)).toBe(true);
  });

  it("같은 노드가 두 갈래에서 매치되면 병합한다(플래그 OR, 신호는 미상 아닌 값 우선)", () => {
    const nodes = normalizeElements([
      el(1, 37.5, 127.0, { highway: "crossing", crossing: "traffic_signals" }),
      el(1, 37.5, 127.0, { highway: "crossing", tactile_paving: "yes" }),
    ]) as Node[];

    expect(nodes).toHaveLength(1);
    expect(isCrossing(nodes[0])).toBe(true);
    expect(isTactile(nodes[0])).toBe(true);
    expect(signalBits(nodes[0])).toBe(1);
  });

  it("비-crossing 점자블록의 호스트를 판별한다", () => {
    const nodes = normalizeElements([
      el(1, 37.5, 127.0, { tactile_paving: "yes", highway: "bus_stop" }),
      el(2, 37.6, 127.0, { tactile_paving: "yes", railway: "subway_entrance" }),
      el(3, 37.7, 127.0, { tactile_paving: "yes" }),
      // crossing이면 호스트를 붙이지 않는다(횡단보도 자체가 위치 설명이다).
      el(4, 37.8, 127.0, { highway: "crossing", tactile_paving: "yes" }),
    ]) as Node[];

    const byId = new Map(nodes.map((n) => [n[0], n]));
    expect(hostBits(byId.get(1)!)).toBe(1);
    expect(hostBits(byId.get(2)!)).toBe(2);
    expect(hostBits(byId.get(3)!)).toBe(0);
    expect(hostBits(byId.get(4)!)).toBe(0);
  });

  it("좌표 없는 원소는 버리고, 좌표는 5자리로 줄이고, 위경도 순으로 정렬한다", () => {
    const nodes = normalizeElements([
      { type: "node", id: 9, tags: { highway: "crossing" } },
      el(2, 37.6123456, 127.0123456, { highway: "crossing" }),
      el(1, 37.5, 127.0, { highway: "crossing" }),
    ]) as Node[];

    expect(nodes.map((n) => n[0])).toEqual([1, 2]);
    expect(nodes[1][1]).toBe(37.61235);
    expect(nodes[1][2]).toBe(127.01235);
  });

  it("krIds 집합이 주어지면 그 밖의 노드를 버린다(국경 밖 배제)", () => {
    const nodes = normalizeElements(
      [
        el(1, 37.5, 127.0, { highway: "crossing" }),
        // 대마도 근처. bbox 질의에는 잡히지만 KR id 집합에는 없다.
        el(2, 34.4, 129.35, { highway: "crossing" }),
      ],
      new Set([1]),
    ) as Node[];

    expect(nodes.map((n) => n[0])).toEqual([1]);
  });
});

describe("validateNodes: 가드", () => {
  it("정상 seed는 통과하고 집계를 낸다", () => {
    const stats = validateNodes(validNodes());
    expect(stats.total).toBeGreaterThanOrEqual(60_000);
    expect(stats.crossing).toBeGreaterThanOrEqual(55_000);
    expect(stats.tactile).toBeGreaterThanOrEqual(4_000);
    expect(stats.dense).toBeGreaterThanOrEqual(GOLDEN_DENSE.minCrossing);
  });

  it("G1 총 노드 수가 모자라면 실패한다", () => {
    expect(() => validateNodes(validNodes().slice(0, 100))).toThrow(/G1/);
  });

  it("G2 횡단보도가 모자라면 실패한다", () => {
    // 플래그에서 crossing 비트만 끈다. 총 노드 수는 그대로다.
    const nodes = validNodes().map((n) => [n[0], n[1], n[2], flags(n) & ~1] as Node);
    expect(() => validateNodes(nodes)).toThrow(/G2/);
  });

  it("G3 점자블록이 모자라면 실패한다", () => {
    const nodes = validNodes().map((n) => [n[0], n[1], n[2], flags(n) & ~(1 << 3)] as Node);
    expect(() => validateNodes(nodes)).toThrow(/G3/);
  });

  it("G4 seed bbox를 벗어난 노드가 있으면 실패한다", () => {
    const nodes = validNodes();
    nodes.push([999_999, SEED_BBOX.latMax + 1, 127.0, 1 | (2 << 1)]);
    expect(() => validateNodes(nodes)).toThrow(/G4/);
  });

  it("G5 국외(대마도) 노드가 섞이면 실패한다", () => {
    // bbox 질의로 되돌아가는 회귀가 정확히 이 모양이다.
    const nodes = validNodes();
    nodes.push([999_999, GOLDEN_ABSENT.lat, GOLDEN_ABSENT.lng, 1 | (2 << 1)]);
    expect(() => validateNodes(nodes)).toThrow(/G5/);
  });

  it("G6 한 지역이 통째로 비면 실패한다", () => {
    const target = GOLDEN_PRESENT[GOLDEN_PRESENT.length - 1];
    const nodes = validNodes().filter(
      (n) => Math.abs(n[1] - target.lat) > 0.3 || Math.abs(n[2] - target.lng) > 0.3,
    );
    expect(() => validateNodes(nodes)).toThrow(/G6/);
  });

  it("G7 도심 횡단보도 밀도가 무너지면 실패한다(총량 가드와 독립으로)", () => {
    // 강남역 반경 노드만 떼어낸다. 20건이라 G1·G2 임계는 그대로 통과하므로
    // 발화하는 가드가 G7 하나임이 확정된다.
    const nodes = validNodes().filter(
      (n) => Math.abs(n[1] - GOLDEN_DENSE.lat) > 0.001 || Math.abs(n[2] - GOLDEN_DENSE.lng) > 0.001,
    );
    expect(() => validateNodes(nodes)).toThrow(/G7/);
  });
});
