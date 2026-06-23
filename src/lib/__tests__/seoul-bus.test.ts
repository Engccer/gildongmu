// 2026-06-24 서울 TOPIS(ws.bus.go.kr) 실호출 fixture로 envelope·필드·저상·메시지 검증.
// 실증 교정: arrmsg1이 도착 낭독 정본(traTime1은 운행종료에도 비0이라 신뢰불가),
// 서울도 routeType 제공(숫자코드 매핑), 도착 순서는 API 순서 보존(재정렬 안 함).
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../env", () => ({ env: { DATA_GO_KR_API_KEY: "test-key" } }));

import fixture from "./fixtures/seoul-bus.json";
import {
  parseSeoulItems,
  parseSeoulStops,
  parseSeoulArrivals,
  parseSeoulRouteStops,
  fetchSeoulNearby,
  fetchSeoulRouteStops,
} from "../providers/seoul-bus";

const parseSeoulItemsCount = (raw: unknown) => parseSeoulItems(raw).length;

describe("parseSeoulItems", () => {
  it("envelope에서 itemList 배열을 뽑는다", () => {
    expect(parseSeoulItems(fixture.nearbyStops).length).toBeGreaterThan(0);
  });
  it("빈 결과(empty envelope·null·{})는 빈 배열", () => {
    expect(parseSeoulItems(fixture.empty)).toEqual([]);
    expect(parseSeoulItems(null)).toEqual([]);
    expect(parseSeoulItems({})).toEqual([]);
  });
  it("itemList가 단일 객체로 와도 배열로 정규화", () => {
    const single = { msgBody: { itemList: { arsId: "X" } } };
    expect(parseSeoulItems(single).length).toBe(1);
  });
});

describe("parseSeoulStops", () => {
  it("정류소를 거리 오름차순 정렬, source=seoul, nodeId=arsId", () => {
    const stops = parseSeoulStops(fixture.nearbyStops, 37.5385, 127.1378);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0].source).toBe("seoul");
    expect(stops[0].name).not.toBe("");
    expect(stops[0].nodeId).not.toBe(""); // arsId
    expect(stops[0].cityCode).toBe("seoul");
    expect(stops[0].arrivalStatus).toBe("ok");
    expect(stops[0].arrivals).toEqual([]);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].distanceMeters).toBeGreaterThanOrEqual(stops[i - 1].distanceMeters);
    }
  });
  it("좌표 결측 항목은 제외", () => {
    const raw = { msgBody: { itemList: [{ arsId: "X", stationNm: "결측" }] } };
    expect(parseSeoulStops(raw, 37.5, 127.1)).toEqual([]);
  });
});

describe("parseSeoulArrivals", () => {
  it("arrmsg1을 정본 메시지로 담고 API 순서 보존, source=seoul", () => {
    const arr = parseSeoulArrivals(fixture.arrivals);
    expect(arr.length).toBe(5);
    expect(arr[0].source).toBe("seoul");
    expect(arr[0].routeNo).toBe("6300");
    expect(arr[0].routeId).not.toBe(""); // busRouteId
    expect(arr[0].arrivalMessage).toBe("운행종료"); // 슬롯이 아닌 완성 문장 정본
    expect(arr[0].routeType).toBe("공항버스"); // routeType "1" 매핑
    // 재정렬하지 않고 API가 준 순서를 보존(운행종료·곧도착이 traTime1로 뒤섞이지 않게)
    expect(arr.map((a) => a.routeNo)).toEqual(["6300", "130", "2312", "3413", "N30"]);
    expect(typeof arr[0].lowFloor).toBe("boolean");
  });
  it("저상버스 판정은 busType1 === '1'", () => {
    const raw = {
      msgBody: {
        itemList: [
          { rtNm: "100", busRouteId: "1", arrmsg1: "곧 도착", busType1: "1", routeType: "3" },
          { rtNm: "200", busRouteId: "2", arrmsg1: "3분후", busType1: "0", routeType: "4" },
        ],
      },
    };
    const arr = parseSeoulArrivals(raw);
    expect(arr[0].lowFloor).toBe(true);
    expect(arr[0].arrivalMessage).toBe("곧 도착");
    expect(arr[0].routeType).toBe("간선버스");
    expect(arr[1].lowFloor).toBe(false);
    expect(arr[1].routeType).toBe("지선버스");
  });
  it("미매핑 routeType은 빈 문자열(가짜 분류 금지)", () => {
    const raw = { msgBody: { itemList: [{ rtNm: "N30", busRouteId: "1", arrmsg1: "출발대기", routeType: "15" }] } };
    expect(parseSeoulArrivals(raw)[0].routeType).toBe("");
  });
  it("2번째 도착 슬롯(arrmsg2)이 1번째와 다르면 둘 다 투영", () => {
    const raw = {
      msgBody: {
        itemList: [
          { rtNm: "272", busRouteId: "1", routeType: "3", arrmsg1: "3분후[2번째 전]", busType1: "1", arrmsg2: "11분후[6번째 전]", busType2: "0" },
        ],
      },
    };
    const arr = parseSeoulArrivals(raw);
    expect(arr.map((a) => a.arrivalMessage)).toEqual(["3분후[2번째 전]", "11분후[6번째 전]"]);
    expect(arr[0].lowFloor).toBe(true); // busType1
    expect(arr[1].lowFloor).toBe(false); // busType2
  });
  it("2번째 슬롯이 1번째와 같으면(운행종료/운행종료) 중복 제거", () => {
    const raw = {
      msgBody: { itemList: [{ rtNm: "6300", busRouteId: "1", arrmsg1: "운행종료", arrmsg2: "운행종료" }] },
    };
    expect(parseSeoulArrivals(raw).length).toBe(1);
  });
  it("노선번호 없는 항목은 제외", () => {
    const raw = { msgBody: { itemList: [{ busRouteId: "1", arrmsg1: "곧 도착" }] } };
    expect(parseSeoulArrivals(raw)).toEqual([]);
  });
});

describe("parseSeoulRouteStops", () => {
  it("경유정류소를 순번 오름차순으로 반환", () => {
    const stops = parseSeoulRouteStops(fixture.routeStops);
    expect(stops.length).toBeGreaterThan(0);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].order).toBeGreaterThanOrEqual(stops[i - 1].order);
    }
    expect(stops[0].name).not.toBe("");
    expect(stops[0].nodeId).not.toBe("");
  });
});

function mockFetchSequence(...payloads: unknown[]) {
  const fn = vi.fn();
  for (const p of payloads) {
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(p) });
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchSeoulNearby", () => {
  it("근접 정류소 + 각 정류소 도착정보를 병렬로 채운다", async () => {
    const near = Math.min(5, parseSeoulItemsCount(fixture.nearbyStops));
    mockFetchSequence(fixture.nearbyStops, ...Array(near).fill(fixture.arrivals));
    const stops = await fetchSeoulNearby(37.5385, 127.1378);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0].source).toBe("seoul");
    expect(stops[0].arrivalStatus).toBe("ok");
    expect(stops[0].arrivals.length).toBeGreaterThan(0);
    expect(stops[0].arrivals[0].arrivalMessage).not.toBe("");
  });

  it("도착조회 실패는 unavailable로 구분(빈 배열로 뭉개지 않음)", async () => {
    const fn = vi.fn();
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(fixture.nearbyStops) });
    fn.mockResolvedValue({ ok: false, status: 500, text: async () => "err" });
    vi.stubGlobal("fetch", fn);
    const stops = await fetchSeoulNearby(37.5385, 127.1378);
    expect(stops[0].arrivalStatus).toBe("unavailable");
    expect(stops[0].arrivals).toEqual([]);
  });

  it("인증실패(headerCd 7)는 throw(조회 실패 ≠ 결과 없음)", async () => {
    const authErr = { msgHeader: { headerCd: "7", headerMsg: "SERVICE KEY IS NOT REGISTERED" } };
    mockFetchSequence(authErr);
    await expect(fetchSeoulNearby(37.5385, 127.1378)).rejects.toThrow();
  });
});

describe("fetchSeoulRouteStops", () => {
  it("경유정류소를 순번 순으로 반환", async () => {
    mockFetchSequence(fixture.routeStops);
    const stops = await fetchSeoulRouteStops("100100508");
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0].order).toBeLessThanOrEqual(stops[stops.length - 1].order);
  });
});
