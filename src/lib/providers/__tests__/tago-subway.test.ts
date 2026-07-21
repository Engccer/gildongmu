import { describe, it, expect } from "vitest";
import {
  ensureItemArray, parseKeywordStations, displayLineName,
  computeServiceDailyType, deriveFirstLast,
} from "../tago-subway";

describe("ensureItemArray", () => {
  it("객체 1건을 배열로, 빈 문자열을 []로", () => {
    expect(ensureItemArray({ response: { body: { items: { item: { a: 1 } } } } })).toEqual([{ a: 1 }]);
    expect(ensureItemArray({ response: { body: { items: "" } } })).toEqual([]);
  });
});

describe("displayLineName", () => {
  it("축약 노선명에 선을 붙인다", () => {
    expect(displayLineName("5호선")).toBe("5호선");
    expect(displayLineName("수인분당")).toBe("수인분당선");
    expect(displayLineName("GTX-A")).toBe("GTX-A선");
  });
});

describe("computeServiceDailyType — KST-3h 서비스데이", () => {
  it("월요일 00:30 KST는 일요일 타입", () => {
    // 2026-07-27(월) 00:30 KST = 2026-07-26T15:30Z
    expect(computeServiceDailyType(Date.UTC(2026, 6, 26, 15, 30)).type).toBe("sunday");
  });
  it("월요일 05:00 KST는 평일 타입", () => {
    expect(computeServiceDailyType(Date.UTC(2026, 6, 26, 20, 0)).type).toBe("weekday");
  });
  it("토요일 낮은 saturday", () => {
    // 2026-07-25(토) 12:00 KST = 03:00Z
    expect(computeServiceDailyType(Date.UTC(2026, 6, 25, 3, 0)).type).toBe("saturday");
  });
});

const SELF = "MTRS152549";
const row = (dep: string, end = "MTRS152531", endNm = "애오개") => ({
  subwayStationId: SELF, endSubwayStationId: end, endSubwayStationNm: endNm, depTime: dep,
});

describe("deriveFirstLast", () => {
  it("심야(<03시)를 +24h 보정해 첫차가 05시대가 된다", () => {
    const r = deriveFirstLast([row("002450"), row("051310", "MTRS152501", "방화"), row("235150")], SELF)!;
    expect(r.first).toEqual({ time: "05:13", terminus: "방화" });
    expect(r.last).toEqual({ time: "00:24", nextDay: true, terminus: "애오개" });
  });
  it("당역 종착·비정상 depTime을 제외한다", () => {
    const r = deriveFirstLast([row("000210", SELF, "강동"), row("abc"), row("051310")], SELF)!;
    expect(r.first.time).toBe("05:13");
    expect(r.last.time).toBe("05:13");
  });
  it("유효 행 0이면 null", () => {
    expect(deriveFirstLast([row("000210", SELF, "강동")], SELF)).toBeNull();
  });
});
