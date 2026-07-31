import { describe, expect, it } from "vitest";
import { parseSeoulRouteInfo, parseTagoRouteHours } from "../bus-service-hours";

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

// 2026-08-01 실호출 캡처(부산 141번). 지역마다 blID 형식이 다르다:
// 부산 5200141000 → BSB5200141000(접두사 붙음), 대구 DGB3000323101 → 동일 값,
// 인천 165000313 → ICB165000313. endsWith가 두 경우를 모두 흡수한다.
const TAGO_141 = {
  response: {
    body: {
      items: {
        item: [
          {
            routeid: "BSB5200141000",
            routeno: "141",
            startvehicletime: "0500",
            endvehicletime: "2200",
          },
          {
            routeid: "BSB5200999000",
            routeno: "141",
            startvehicletime: "0600",
            endvehicletime: "2100",
          },
        ],
      },
    },
  },
};

describe("parseTagoRouteHours", () => {
  it("routeid가 busLocalBlID로 끝나는 항목만 고른다", () => {
    expect(parseTagoRouteHours(TAGO_141, "5200141000")).toEqual({
      firstMinutes: 300,
      lastMinutes: 1320,
    });
  });
  it("대구처럼 blID가 접두사를 이미 포함하면 동일 값으로 매칭된다", () => {
    const daegu = {
      response: {
        body: {
          items: {
            item: {
              routeid: "DGB3000323101",
              routeno: "232-1",
              startvehicletime: "0530",
              endvehicletime: "2202",
            },
          },
        },
      },
    };
    expect(parseTagoRouteHours(daegu, "DGB3000323101")).toEqual({
      firstMinutes: 330,
      lastMinutes: 1322,
    });
  });
  it("남는 접두사가 알파벳이 아니면 매칭하지 않는다(숫자 꼬리 우연 일치 차단)", () => {
    const trap = {
      response: {
        body: {
          items: {
            item: { routeid: "BSB5200140113", routeno: "141", startvehicletime: "0500", endvehicletime: "2200" },
          },
        },
      },
    };
    // "0113"으로 끝나긴 하지만 남는 부분 "BSB520014"에 숫자가 섞여 있다
    expect(parseTagoRouteHours(trap, "0113")).toBeNull();
  });
  it("끝자리가 맞는 항목이 없으면 null이다(이름만 같은 노선 오매칭 금지)", () => {
    expect(parseTagoRouteHours(TAGO_141, "9999999999")).toBeNull();
  });
  it("결과가 없으면 null이다", () => {
    expect(parseTagoRouteHours({ response: { body: { items: "" } } }, "1")).toBeNull();
  });
});
