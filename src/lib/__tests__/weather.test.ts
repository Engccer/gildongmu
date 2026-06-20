import { describe, it, expect } from "vitest";
import { latLngToGrid } from "../providers/weather";

describe("latLngToGrid", () => {
  it("서울시청(37.5665, 126.9780) → nx 60, ny 127 (기상청 레퍼런스)", () => {
    expect(latLngToGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
  });

  it("동일 입력 동일 출력(결정적)", () => {
    const a = latLngToGrid(37.538, 127.139);
    const b = latLngToGrid(37.538, 127.139);
    expect(a).toEqual(b);
  });

  it("정수 격자를 반환한다", () => {
    const { nx, ny } = latLngToGrid(35.1796, 129.0756); // 부산
    expect(Number.isInteger(nx)).toBe(true);
    expect(Number.isInteger(ny)).toBe(true);
  });
});
