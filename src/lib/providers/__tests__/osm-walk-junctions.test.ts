import { describe, expect, it } from "vitest";
import { findOsmJunctionsNear } from "../osm-walk-junctions";
import seed from "../../data/osm-walk-junctions.json";

// 실 seed 대상(정적 파일, 무호출). 표본은 공개 지명.
describe("OSM 교차점 seed 조회", () => {
  it("길동역 200m 안 주택가 골목 교차점, 가까운 순 상한", async () => {
    const near = await findOsmJunctionsNear(37.5379, 127.14, 200, 10);
    expect(near).toHaveLength(10);
    expect(near!.every((j) => j.branches.length >= 3)).toBe(true);
    expect(near!.some((j) => j.branches.some((b) => b.kind === "alley"))).toBe(true);
  });

  it("seed 범위(서울 bbox) 밖은 0건이 아니라 미제공(null)", async () => {
    expect(await findOsmJunctionsNear(35.1796, 129.0756, 300, 150)).toBeNull();
  });

  it("범위 안 빈 자리(한강 위)는 빈 배열", async () => {
    expect(await findOsmJunctionsNear(37.518, 126.99, 100, 150)).toEqual([]);
  });

  it("seed 메타가 ODbL·범위·데이터 시점을 든다", () => {
    expect(seed.meta.license).toBe("ODbL 1.0");
    expect(seed.meta.region.latMin).toBeLessThan(37.5);
    expect(seed.meta.extractLastModified ?? seed.meta.extractFileTime).toBeTruthy();
  });
});
