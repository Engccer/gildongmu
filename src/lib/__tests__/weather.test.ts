import { describe, it, expect } from "vitest";
import { latLngToGrid, ultraSrtNcstBaseTime, vilageFcstBaseTime } from "../providers/weather";

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

describe("ultraSrtNcstBaseTime (KST, 40분 경계)", () => {
  it("KST 13:30(분<40) → 직전 정시 12:00", () => {
    // 2026-06-20T04:30:00Z == KST 13:30
    expect(ultraSrtNcstBaseTime(new Date("2026-06-20T04:30:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1200",
    });
  });

  it("KST 13:50(분>=40) → 당시 정시 13:00", () => {
    expect(ultraSrtNcstBaseTime(new Date("2026-06-20T04:50:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1300",
    });
  });

  it("KST 00:10 → 전날 23:00(자정 경계)", () => {
    // 2026-06-19T15:10:00Z == KST 00:10(20일)
    expect(ultraSrtNcstBaseTime(new Date("2026-06-19T15:10:00Z"))).toEqual({
      baseDate: "20260619",
      baseTime: "2300",
    });
  });
});

describe("vilageFcstBaseTime (KST, 발표시각)", () => {
  it("KST 13:30 → 11:00 발표분(가장 최근)", () => {
    expect(vilageFcstBaseTime(new Date("2026-06-20T04:30:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1100",
    });
  });

  it("KST 01:00(첫 발표 전) → 전날 23:00", () => {
    // 2026-06-19T16:00:00Z == KST 01:00(20일)
    expect(vilageFcstBaseTime(new Date("2026-06-19T16:00:00Z"))).toEqual({
      baseDate: "20260619",
      baseTime: "2300",
    });
  });

  it("KST 14:05(14시 발표+10분 미경과) → 11:00", () => {
    expect(vilageFcstBaseTime(new Date("2026-06-20T05:05:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1100",
    });
  });
});
