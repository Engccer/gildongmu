import { describe, expect, it } from "vitest";
import { KIND, computeJunctions, encodeBranch, walkAlong, wayKind } from "./build-osm-walk-junctions.mjs";

// 합성 격자(무호출). 원점에서 북·동 미터 → 좌표.
const at = (north, east) => [37.5 + north / 111_320, 127.0 + east / (111_320 * Math.cos((37.5 * Math.PI) / 180))];

describe("wayKind (변형 B)", () => {
  it("큰길·골목·보행로를 가르고 거짓 갈래 재료는 뺀다", () => {
    expect(wayKind({ highway: "primary" })).toBe(KIND.road);
    expect(wayKind({ highway: "residential" })).toBe(KIND.alley);
    expect(wayKind({ highway: "service" })).toBe(KIND.alley);
    expect(wayKind({ highway: "footway" })).toBe(KIND.path);
    for (const tags of [
      { highway: "footway", footway: "crossing" },
      { highway: "footway", footway: "sidewalk" },
      { highway: "service", service: "parking_aisle" },
      { highway: "service", service: "driveway" },
      { highway: "cycleway" },
      { highway: "steps" },
      { highway: "track" },
      { highway: "pedestrian", area: "yes" },
      {},
    ]) {
      expect(wayKind(tags)).toBeNull();
    }
  });
});

describe("computeJunctions", () => {
  // 남북 골목(1→2→3)에 서쪽 골목(2→4)과 동쪽 짧은 막다른 진입로(2→5, 8m)가 붙은 T자.
  const coords = new Map([
    [1, at(-40, 0)],
    [2, at(0, 0)],
    [3, at(40, 0)],
    [4, at(0, -40)],
    [5, at(0, 8)],
    [6, at(0, 40)],
  ]);

  it("3갈래 노드만, 갈래는 종류×36+방위/10", () => {
    const ways = [
      { id: 10, nodes: [1, 2, 3], tags: { highway: "residential" } },
      { id: 11, nodes: [2, 4], tags: { highway: "footway" } },
    ];
    const out = computeJunctions(ways, coords);
    expect(out).toHaveLength(1);
    expect(out[0][2]).toEqual(
      [encodeBranch(KIND.alley, 0), encodeBranch(KIND.alley, 180), encodeBranch(KIND.path, 270)].sort((a, b) => a - b),
    );
  });

  it("20m 안에서 끝나는 막다른 갈래(진입로 꼬리)는 세지 않는다 — 남은 갈래가 2개면 교차점이 아니다", () => {
    const ways = [
      { id: 10, nodes: [1, 2, 3], tags: { highway: "residential" } },
      { id: 12, nodes: [2, 5], tags: { highway: "service" } },
    ];
    expect(computeJunctions(ways, coords)).toEqual([]);
  });

  it("40m 막다른 갈래는 센다(실제 골목)", () => {
    const ways = [
      { id: 10, nodes: [1, 2, 3], tags: { highway: "residential" } },
      { id: 13, nodes: [2, 6], tags: { highway: "residential" } },
    ];
    expect(computeJunctions(ways, coords)).toHaveLength(1);
  });

  it("두 way로 쪼개진 짧은 막다른 진입로(footway 9m + footway 6m)도 꼬리로 뺀다(way 경계 너머 추적)", () => {
    const c = new Map([...coords, [7, at(0, 9)], [8, at(0, 15)]]);
    const ways = [
      { id: 10, nodes: [1, 2, 3], tags: { highway: "residential" } },
      { id: 16, nodes: [2, 7], tags: { highway: "footway" } },
      { id: 17, nodes: [7, 8], tags: { highway: "footway", lit: "yes" } },
    ];
    expect(computeJunctions(ways, c)).toEqual([]);
  });

  it("횡단보도 선·보도 선은 갈래를 만들지 않는다", () => {
    const ways = [
      { id: 10, nodes: [1, 2, 3], tags: { highway: "residential" } },
      { id: 14, nodes: [2, 4], tags: { highway: "footway", footway: "crossing" } },
      { id: 15, nodes: [2, 6], tags: { highway: "footway", footway: "sidewalk" } },
    ];
    expect(computeJunctions(ways, coords)).toEqual([]);
  });
});

describe("walkAlong", () => {
  it("25m 간 점을 보간하고, 짧으면 끝점", () => {
    const pts = [at(0, 0), at(10, 0), at(40, 0)];
    const r = walkAlong(pts, 25);
    expect(r.length).toBe(25);
    expect(r.point[0]).toBeCloseTo(at(25, 0)[0], 6);
    expect(walkAlong([at(0, 0), at(10, 0)], 25).point).toEqual(at(10, 0));
  });
});
