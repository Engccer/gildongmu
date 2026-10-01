import { describe, expect, it } from "vitest";
import { findSeoulWalkNetworkNear, seoulCellKey } from "../seoul-walk-network";
import seed from "../../data/seoul-walk-network.json";

// 실 seed 대상(정적 파일, 무호출). 표본은 공개 지명(강남역·길동역)과 서울 밖(수원).
describe("서울 도보 네트워크 seed 조회", () => {
  it("강남역 300m 안에 횡단보도·교차점이 있고 가까운 순 상한을 지킨다", async () => {
    const near = await findSeoulWalkNetworkNear(37.4979, 127.0276, 300, { crosswalks: 60, junctions: 150 });
    expect(near).not.toBeNull();
    expect(near!.crosswalks.length).toBeGreaterThan(5);
    expect(near!.crosswalks.length).toBeLessThanOrEqual(60);
    expect(near!.junctions.length).toBeGreaterThan(5);
    expect(near!.junctions.every((j) => j.branches.length >= 3)).toBe(true);
  });

  it("길동역 주택가 골목 격자에 교차점이 있다", async () => {
    const near = await findSeoulWalkNetworkNear(37.5379, 127.14, 200, { crosswalks: 60, junctions: 150 });
    expect(near!.junctions.length).toBeGreaterThan(10);
    expect(near!.junctions.some((j) => j.branches.some((b) => b.kind === "alley"))).toBe(true);
  });

  it("서울 밖(수원)은 0건이 아니라 미제공(null)", async () => {
    expect(await findSeoulWalkNetworkNear(37.2636, 127.0286, 300, { crosswalks: 60, junctions: 150 })).toBeNull();
  });

  it("횡단보도 점은 쌍을 접은 것이라 서로 1m 안에 겹치지 않는다(한 횡단보도 = 점 하나)", () => {
    const keys = new Set(seed.crosswalks.map(([a, b]) => `${a},${b}`));
    expect(keys.size).toBe(seed.crosswalks.length);
  });

  it("seed 메타가 출처 표시(서울특별시 공공데이터)·공공누리 1유형을 든다", () => {
    expect(seed.meta.attribution).toBe("서울특별시 공공데이터");
    expect(seed.meta.license).toContain("공공누리 제1유형");
    expect(seed.cells).toContain(seoulCellKey(37.5665, 126.978));
  });
});
