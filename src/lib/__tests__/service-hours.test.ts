import { describe, expect, it } from "vitest";
import {
  judgeServiceStatus,
  parseServiceTime,
  kstNowMinutes,
  SERVICE_RANK,
} from "../service-hours";

describe("parseServiceTime", () => {
  it("TOPIS 12자리(YYYYMMDDHHMM)를 분으로 변환한다", () => {
    expect(parseServiceTime("202608010400")).toBe(240);
    expect(parseServiceTime("202608012230")).toBe(1350);
  });
  it("TAGO 4자리(HHMM)를 분으로 변환한다", () => {
    expect(parseServiceTime("0430")).toBe(270);
    expect(parseServiceTime("2300")).toBe(1380);
  });
  it("TOPIS 14자리(YYYYMMDDHHMMSS)도 받는다", () => {
    expect(parseServiceTime("20260801040000")).toBe(240);
  });
  it("결측·형식 위반은 null이다(0으로 뭉개지 않는다)", () => {
    expect(parseServiceTime(null)).toBeNull();
    expect(parseServiceTime(undefined)).toBeNull();
    expect(parseServiceTime("")).toBeNull();
    expect(parseServiceTime("abc")).toBeNull();
    expect(parseServiceTime("999")).toBeNull();
    expect(parseServiceTime("2561")).toBeNull(); // 25시 61분
  });
});

describe("judgeServiceStatus", () => {
  it("주간 노선: 운행 구간 안이면 running", () => {
    expect(judgeServiceStatus(600, 240, 1350)).toBe("running"); // 10:00, 04:00~22:30
  });
  it("주간 노선: 첫차 전이면 outside", () => {
    expect(judgeServiceStatus(238, 240, 1350)).toBe("outside"); // 03:58
  });
  it("주간 노선: 막차 후면 outside", () => {
    expect(judgeServiceStatus(1400, 240, 1350)).toBe("outside"); // 23:20
  });
  it("경계값(첫차·막차 정각)은 running이다", () => {
    expect(judgeServiceStatus(240, 240, 1350)).toBe("running");
    expect(judgeServiceStatus(1350, 240, 1350)).toBe("running");
  });
  it("심야 노선(자정 넘김): 막차<첫차일 때 양쪽 구간을 running으로 본다", () => {
    // N30 23:10~03:50
    expect(judgeServiceStatus(1400, 1390, 230)).toBe("running"); // 23:20
    expect(judgeServiceStatus(60, 1390, 230)).toBe("running"); // 01:00
    expect(judgeServiceStatus(238, 1390, 230)).toBe("outside"); // 03:58, 막차 후
    expect(judgeServiceStatus(600, 1390, 230)).toBe("outside"); // 10:00
  });
  it("첫차·막차 중 하나라도 없으면 unknown이다(추정 금지)", () => {
    expect(judgeServiceStatus(600, null, 1350)).toBe("unknown");
    expect(judgeServiceStatus(600, 240, null)).toBe("unknown");
    expect(judgeServiceStatus(600, null, null)).toBe("unknown");
  });
});

describe("kstNowMinutes", () => {
  it("UTC Date를 KST 기준 분으로 변환한다", () => {
    // 2026-07-31T18:58:00Z = 2026-08-01 03:58 KST
    expect(kstNowMinutes(new Date("2026-07-31T18:58:00Z"))).toBe(238);
    // 2026-08-01T05:00:00Z = 14:00 KST
    expect(kstNowMinutes(new Date("2026-08-01T05:00:00Z"))).toBe(840);
  });
});

describe("SERVICE_RANK", () => {
  it("running < unknown < outside 순이다(정보 없음을 결함으로 단정하지 않는다)", () => {
    expect(SERVICE_RANK.running).toBeLessThan(SERVICE_RANK.unknown);
    expect(SERVICE_RANK.unknown).toBeLessThan(SERVICE_RANK.outside);
  });
});
