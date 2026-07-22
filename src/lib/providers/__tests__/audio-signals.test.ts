import { describe, it, expect } from "vitest";
import { findAudioSignalsNear, clusterSites } from "../audio-signals";

describe("findAudioSignalsNear", () => {
  it("서울 좌표(길동)는 non-null이고 deviceCount≥0", () => {
    const result = findAudioSignalsNear(37.5378, 127.1399);
    expect(result).not.toBeNull();
    expect(result!.deviceCount).toBeGreaterThanOrEqual(0);
    expect(typeof result!.baseDate).toBe("string");
  });

  it("서울 bbox 밖(부산)은 null", () => {
    expect(findAudioSignalsNear(35.18, 129.07)).toBeNull();
  });

  it("반경 밖 점은 미포함(반경을 0으로 좁히면 deviceCount 0)", () => {
    const result = findAudioSignalsNear(37.5378, 127.1399, 0);
    expect(result).not.toBeNull();
    expect(result!.deviceCount).toBe(0);
    expect(result!.sites).toEqual([]);
  });

  it("sites는 가까운 순·최대 5", () => {
    const result = findAudioSignalsNear(37.5378, 127.1399, 1000);
    expect(result).not.toBeNull();
    expect(result!.sites.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < result!.sites.length; i++) {
      expect(result!.sites[i].distanceMeters).toBeGreaterThanOrEqual(
        result!.sites[i - 1].distanceMeters,
      );
    }
  });
});

describe("clusterSites — 좌표 4자리 군집", () => {
  const origin = { lat: 37.5378, lng: 127.1399 };

  it("같은 4자리 좌표 2점이 site 1개 deviceCount 2", () => {
    const points: Array<[number, number]> = [
      [37.53781, 127.14001],
      [37.53783, 127.14004],
    ];
    const sites = clusterSites(points, origin);
    expect(sites.length).toBe(1);
    expect(sites[0].deviceCount).toBe(2);
  });

  it("4자리가 다른 좌표는 별도 site", () => {
    const points: Array<[number, number]> = [
      [37.53781, 127.14001],
      [37.54781, 127.15001],
    ];
    const sites = clusterSites(points, origin);
    expect(sites.length).toBe(2);
    expect(sites.every((s) => s.deviceCount === 1)).toBe(true);
  });

  it("가까운 순 정렬·최대 5", () => {
    const points: Array<[number, number]> = Array.from({ length: 8 }, (_, i) => {
      const offset = (i + 1) * 0.001;
      return [origin.lat + offset, origin.lng + offset] as [number, number];
    });
    const sites = clusterSites(points, origin);
    expect(sites.length).toBe(5);
    for (let i = 1; i < sites.length; i++) {
      expect(sites[i].distanceMeters).toBeGreaterThanOrEqual(sites[i - 1].distanceMeters);
    }
  });
});
