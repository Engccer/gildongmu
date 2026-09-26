import { describe, it, expect } from "vitest";
import { findAudioSignalsNear, clusterSites, hasAudioSignalNear } from "../audio-signals";
import seed from "../../data/audio-signals.json";

const signals = (seed as unknown as { signals: [number, number][] }).signals;

describe("hasAudioSignalNear", () => {
  it("seed 지점 자체는 true(반경 40m)", () => {
    const [lat, lng] = signals[0];
    expect(hasAudioSignalNear(lat, lng, 40)).toBe(true);
  });

  it("서울 안이지만 신호기 원거리(한강 중앙, 최근접 136m 실측)는 false", () => {
    // 2026-07-28 seed 기준 실측: 37.5200,126.9800 최근접 136m. seed 연1회 갱신 시 재확인.
    expect(hasAudioSignalNear(37.52, 126.98, 40)).toBe(false);
  });

  it("서울 bbox 밖(부산)은 false", () => {
    expect(hasAudioSignalNear(35.1796, 129.0756, 40)).toBe(false);
  });
});

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

  it("기본 모양엔 좌표가 없다(종전 계약)", () => {
    const sites = clusterSites([[37.53781, 127.14001]], origin);
    expect(sites[0]).not.toHaveProperty("lat");
    expect(sites[0]).not.toHaveProperty("lng");
  });

  it("좌표 옵트인은 대표점(최근접 원시 점) 좌표를 싣고 상한을 넓힌다(나들이)", () => {
    const points: Array<[number, number]> = Array.from({ length: 8 }, (_, i) => {
      const offset = (i + 1) * 0.001;
      return [origin.lat + offset, origin.lng + offset] as [number, number];
    });
    points.push([37.53783, 127.14004], [37.53781, 127.14001]);
    const sites = clusterSites(points, origin, { withCoords: true, maxSites: 40 });
    expect(sites.length).toBe(9);
    expect(sites[0]).toMatchObject({ lat: 37.53781, lng: 127.14001, deviceCount: 2 });
  });
});
