import { describe, expect, it } from "vitest";
import {
  classifyBucket,
  entranceFrame,
  fitRoadAxis,
  toLocalXY,
} from "../road-axis";

const ORIGIN = { lat: 37.5, lng: 127.0 };

/** 원점에서 정동쪽으로 번호 1당 10m 늘어서는 가상 도로 */
function eastwardSamples() {
  const mPerDegLng = 111_320 * Math.cos((37.5 * Math.PI) / 180);
  return [1, 3, 5, 7, 9].map((main) => ({
    main,
    lat: 37.5,
    lng: 127.0 + ((main - 1) * 10) / mPerDegLng,
  }));
}

describe("toLocalXY", () => {
  it("동쪽으로 100m 떨어진 점은 x≈100, y≈0", () => {
    const mPerDegLng = 111_320 * Math.cos((37.5 * Math.PI) / 180);
    const p = { lat: 37.5, lng: 127.0 + 100 / mPerDegLng };
    const { x, y } = toLocalXY(ORIGIN, p);
    expect(x).toBeCloseTo(100, 0);
    expect(y).toBeCloseTo(0, 0);
  });
});

describe("fitRoadAxis", () => {
  it("번호 증가 방향을 단위벡터로 준다", () => {
    const axis = fitRoadAxis(ORIGIN, eastwardSamples())!;
    expect(axis.ux).toBeCloseTo(1, 2);
    expect(axis.uy).toBeCloseTo(0, 2);
  });

  it("번호 1당 진행거리를 낸다", () => {
    const axis = fitRoadAxis(ORIGIN, eastwardSamples())!;
    expect(axis.metersPerNumber).toBeCloseTo(10, 0);
  });

  it("표본이 3개 미만이면 null (축을 세울 수 없다)", () => {
    expect(fitRoadAxis(ORIGIN, eastwardSamples().slice(0, 2))).toBeNull();
  });

  it("번호와 좌표가 무상관이면 null — 거짓 축을 세우지 않는다", () => {
    const samples = [1, 3, 5, 7].map((main) => ({ main, lat: 37.5, lng: 127.0 }));
    expect(fitRoadAxis(ORIGIN, samples)).toBeNull();
  });

  it("본번이 같은 표본만 있으면 null (분산 0)", () => {
    const samples = [5, 5, 5].map((main) => ({ main, lat: 37.5, lng: 127.001 }));
    expect(fitRoadAxis(ORIGIN, samples)).toBeNull();
  });
});

describe("entranceFrame", () => {
  // 축이 정동쪽(ux=1)일 때, 홀수 건물은 진행 왼쪽 = 북쪽에 있다.
  // 사용자는 도로(남쪽)에서 건물(북쪽)을 본다 → 시선은 북쪽(+y).
  const axis = { ux: 1, uy: 0, metersPerNumber: 10, sampleCount: 5 };

  it("홀수 앵커의 시선은 축을 +90° 돌린 방향", () => {
    const f = entranceFrame(axis, true);
    expect(f.vx).toBeCloseTo(0, 6);
    expect(f.vy).toBeCloseTo(1, 6);
  });

  it("짝수 앵커의 시선은 정반대", () => {
    const f = entranceFrame(axis, false);
    expect(f.vy).toBeCloseTo(-1, 6);
  });

  it("사용자 오른쪽은 시선을 -90° 돌린 방향 (홀수면 축 방향)", () => {
    const f = entranceFrame(axis, true);
    expect(f.rx).toBeCloseTo(1, 6);
    expect(f.ry).toBeCloseTo(0, 6);
  });
});

describe("classifyBucket", () => {
  const axis = { ux: 1, uy: 0, metersPerNumber: 10, sampleCount: 5 };
  const frame = entranceFrame(axis, true); // 홀수 앵커, 시선 북
  const mPerDegLng = 111_320 * Math.cos((37.5 * Math.PI) / 180);
  const east = (m: number) => ({ lat: 37.5, lng: 127.0 + m / mPerDegLng });
  const north = (m: number) => ({ lat: 37.5 + m / 110_574, lng: 127.0 });

  it("축 방향(동쪽)은 오른쪽", () => {
    expect(classifyBucket(frame, ORIGIN, east(50), {})).toBe("right");
  });

  it("축 반대(서쪽)는 왼쪽", () => {
    expect(classifyBucket(frame, ORIGIN, east(-50), {})).toBe("left");
  });

  it("시선 방향으로 임계를 넘으면 건물 너머", () => {
    expect(classifyBucket(frame, ORIGIN, north(40), {})).toBe("beyond");
  });

  it("시선 방향이라도 임계 안이면 좌우로 남는다", () => {
    expect(
      classifyBucket(frame, ORIGIN, { lat: north(10).lat, lng: east(30).lng }, {}),
    ).toBe("right");
  });

  it("같은 도로 홀짝 반대는 맞은편이 건물 너머를 이긴다", () => {
    expect(classifyBucket(frame, ORIGIN, north(40), { acrossByParity: true })).toBe(
      "across",
    );
  });
});
