import { describe, expect, it } from "vitest";
import { BRANCH_POINT_METERS, decodeJunction, nearestRows } from "../walk-junction";
import { haversineMeters } from "../geo";
import { bearingDegrees } from "../geo/bearing";

describe("decodeJunction (갈래 부호 kind×36 + 방위/10)", () => {
  it("종류와 방위를 25m 간 점으로 푼다", () => {
    const j = decodeJunction([37.5, 127.0, [0 * 36 + 0, 1 * 36 + 9, 2 * 36 + 27]]);
    expect(j.branches.map((b) => b.kind)).toEqual(["alley", "road", "path"]);
    const bearings = j.branches.map((b) => Math.round(bearingDegrees(37.5, 127.0, b.lat, b.lng)));
    expect(bearings).toEqual([0, 90, 270]);
    for (const b of j.branches) {
      expect(Math.abs(haversineMeters(37.5, 127.0, b.lat, b.lng) - BRANCH_POINT_METERS)).toBeLessThan(0.5);
    }
  });

  it("미지 종류 부호는 버린다(거짓 갈래를 만들지 않는다)", () => {
    expect(decodeJunction([37.5, 127.0, [3 * 36 + 1, 0]]).branches).toHaveLength(1);
  });
});

describe("nearestRows (위도 정렬 행의 반경 조회)", () => {
  const rows: Array<[number, number]> = [
    [37.4990, 127.0],
    [37.49985, 127.0],
    [37.5, 127.0005],
    [37.5001, 127.0],
    [37.5, 127.01],
    [37.51, 127.0],
  ].sort((a, b) => a[0] - b[0]) as Array<[number, number]>;

  it("반경 안만, 가까운 순, 상한까지", () => {
    const got = nearestRows(rows, 37.5, 127.0, 150, 10);
    expect(got).toEqual([
      [37.5001, 127.0],
      [37.49985, 127.0],
      [37.5, 127.0005],
      [37.499, 127.0],
    ]);
    expect(nearestRows(rows, 37.5, 127.0, 150, 2)).toHaveLength(2);
  });

  it("0건은 빈 배열", () => {
    expect(nearestRows(rows, 37.6, 127.0, 100, 10)).toEqual([]);
  });
});
