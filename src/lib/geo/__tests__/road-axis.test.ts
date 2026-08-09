import { describe, expect, it } from "vitest";
import { fitRoadAxis, toLocalXY } from "../road-axis";

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
