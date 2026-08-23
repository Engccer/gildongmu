import { describe, expect, it } from "vitest";
import { isInKorea } from "../coverage";
import seed from "../data/osm-walk-nodes.json";
import cases from "./fixtures/korea-boundary-cases.json";

describe("isInKorea — 국경 폴리곤 판정", () => {
  it("공유 golden 전수를 맞힌다", () => {
    for (const c of cases.cases) {
      expect(isInKorea(c.lat, c.lng), c.name).toBe(c.inside);
    }
  });

  it("사각형 밖 좌표는 여전히 밖이다", () => {
    expect(isInKorea(37.7749, -122.4194)).toBe(false); // 샌프란시스코
    expect(isInKorea(0, 0)).toBe(false); // 널 아일랜드
  });

  it("OSM seed 노드 전수가 폴리곤 안이다", () => {
    // 빌드 스크립트의 insideRings와 coverage.ts의 ray casting은 서로 다른 코드다.
    // 이 단언이 두 구현의 합의를 8만 점으로 확인한다(spec §3 방어 2) — 링이 잘못
    // 실렸거나 두 구현이 어긋나면 "국내인데 제공 지역 밖"이라는 조용한 결함이
    // 되는데, 그 방향은 종전 사각형에는 없던 새 실패 모드다.
    const nodes = (seed as unknown as { nodes: Array<[number, number, number, number]> }).nodes;
    expect(nodes.length).toBeGreaterThan(70_000);
    const stray = nodes.find((n) => !isInKorea(n[1], n[2]));
    expect(stray && `노드 ${stray[0]}(${stray[1]}, ${stray[2]})`).toBeUndefined();
  });
});
