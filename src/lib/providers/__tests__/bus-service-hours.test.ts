import { describe, expect, it } from "vitest";
import { parseSeoulRouteInfo } from "../bus-service-hours";

// 2026-08-01 실호출 캡처(342번, busRouteId=124000038).
// ⚠ TOPIS는 12자리가 아니라 14자리(YYYYMMDDHHMMSS)로 준다. 실호출로 확정한 값이므로
//    슬라이스 범위를 바꾸려면 이 fixture부터 다시 캡처할 것.
const SEOUL_342 = {
  msgHeader: { headerCd: "0", headerMsg: "정상적으로 처리되었습니다." },
  msgBody: {
    itemList: [
      {
        busRouteId: "124000038",
        busRouteNm: "342",
        firstBusTm: "20260801040000",
        lastBusTm: "20260801223000",
      },
    ],
  },
};

describe("parseSeoulRouteInfo", () => {
  it("TOPIS 응답에서 첫차·막차를 분으로 뽑는다", () => {
    expect(parseSeoulRouteInfo(SEOUL_342)).toEqual({
      firstMinutes: 240,
      lastMinutes: 1350,
    });
  });
  it("itemList가 비면 null이다", () => {
    expect(
      parseSeoulRouteInfo({ msgHeader: { headerCd: "4" }, msgBody: { itemList: [] } }),
    ).toBeNull();
  });
  it("itemList가 없으면 null이다", () => {
    expect(parseSeoulRouteInfo({ msgHeader: { headerCd: "0" } })).toBeNull();
  });
  it("시각 필드가 결측이면 null 슬롯으로 보존한다(0으로 뭉개지 않는다)", () => {
    const raw = { msgBody: { itemList: [{ busRouteId: "1", busRouteNm: "X" }] } };
    expect(parseSeoulRouteInfo(raw)).toEqual({ firstMinutes: null, lastMinutes: null });
  });
  it("응답이 객체가 아니면 null이다", () => {
    expect(parseSeoulRouteInfo(null)).toBeNull();
    expect(parseSeoulRouteInfo("nope")).toBeNull();
  });
});
