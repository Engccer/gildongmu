import { describe, it, expect } from "vitest";
import { parseElevatorRows, composeElevatorItems } from "../seoul-elevator";

const raw = {
  tbTraficElvtr: {
    list_total_count: 2,
    RESULT: { CODE: "INFO-000" },
    row: [
      { NODE_WKT: "POINT(127.1329072 37.5359120)", SBWY_STN_NM: "강동", EMD_NM: "성내동" },
      { NODE_WKT: "POINT(127.1317901 37.5362824)", SBWY_STN_NM: "강동", EMD_NM: "성내동" },
      { NODE_WKT: "bogus", SBWY_STN_NM: "파싱불가" },
    ],
  },
};

describe("parseElevatorRows", () => {
  it("WKT(lng lat)를 파싱하고 비정상 행을 버린다", () => {
    const rows = parseElevatorRows(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ stationKey: "강동", lat: 37.535912, lng: 127.1329072, dong: "성내동" });
  });
});

describe("composeElevatorItems — 방위·거리 ko 합성", () => {
  const seedRows = [
    { name: "강동", nameEn: "Gangdong", lineName: "5호선", operator: "서울교통공사", lat: 37.5354, lng: 127.1323, isTransfer: false },
  ];
  it("최근접 seed 좌표 기준 방위·거리 텍스트를 만든다", () => {
    const items = composeElevatorItems(parseElevatorRows(raw), seedRows);
    expect(items).toHaveLength(2);
    expect(items[0].name).toMatch(/^역 중심 기준 (북|북동|동|남동|남|남서|서|북서)쪽 약 \d+m, 성내동$/);
  });
  it("seed 좌표가 없으면 빈 배열(방위 없는 나열은 무가치)", () => {
    expect(composeElevatorItems(parseElevatorRows(raw), [])).toEqual([]);
  });
});
