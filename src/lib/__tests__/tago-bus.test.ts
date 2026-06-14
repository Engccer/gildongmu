import { describe, it, expect } from "vitest";
import fixture from "./fixtures/tago-bus.json";
import {
  parseTagoItems,
  haversineMeters,
  parseBusStops,
  parseBusArrivals,
  parseBusRouteStops,
} from "../providers/tago-bus";

describe("parseTagoItems", () => {
  it("envelope에서 item 배열을 뽑는다", () => {
    expect(parseTagoItems(fixture.nearbyStops).length).toBe(2);
  });
  it("빈 결과(items:'')는 빈 배열", () => {
    expect(parseTagoItems(fixture.empty)).toEqual([]);
    expect(parseTagoItems(null)).toEqual([]);
    expect(parseTagoItems({})).toEqual([]);
  });
  it("item이 단일 객체로 와도 배열로 정규화", () => {
    const single = { response: { body: { items: { item: { nodeid: "X" } } } } };
    expect(parseTagoItems(single).length).toBe(1);
  });
});

describe("haversineMeters", () => {
  it("같은 점은 0", () => {
    expect(haversineMeters(35.1795, 129.0756, 35.1795, 129.0756)).toBe(0);
  });
  it("부산역↔부산역환승센터 ≈ 170m(±30m)", () => {
    const d = haversineMeters(35.1795, 129.0756, 35.181, 129.076);
    expect(d).toBeGreaterThan(140);
    expect(d).toBeLessThan(200);
  });
});

describe("parseBusStops", () => {
  it("정류소를 거리 오름차순으로 정렬한다", () => {
    // 출발점을 첫 정류소 좌표로 → 그 정류소가 distance 0으로 맨 앞
    const stops = parseBusStops(fixture.nearbyStops, 35.1795, 129.0756);
    expect(stops.length).toBe(2);
    expect(stops[0].name).toBe("부산역");
    expect(stops[0].distanceMeters).toBe(0);
    expect(stops[0].nodeId).toBe("DGB7011001400");
    expect(stops[0].cityCode).toBe("23");
    expect(stops[0].stopNo).toBe("7011");
    expect(stops[1].distanceMeters).toBeGreaterThan(stops[0].distanceMeters);
    expect(stops[0].arrivals).toEqual([]);
  });
  it("좌표 결측 항목은 제외", () => {
    const raw = { response: { body: { items: { item: [{ nodeid: "X", nodenm: "결측", citycode: 1 }] } } } };
    expect(parseBusStops(raw, 35, 129)).toEqual([]);
  });
});

describe("parseBusArrivals", () => {
  it("도착 임박 순으로 정렬하고 저상버스를 판정한다", () => {
    const arr = parseBusArrivals(fixture.arrivals);
    expect(arr.length).toBe(2);
    // arrtime 180(81번)이 720(1003번)보다 먼저
    expect(arr[0].routeNo).toBe("81");
    expect(arr[0].arrivalSeconds).toBe(180);
    expect(arr[0].prevStationCount).toBe(2);
    expect(arr[0].lowFloor).toBe(true);
    expect(arr[0].routeId).toBe("DGB3001");
    expect(arr[1].routeNo).toBe("1003");
    expect(arr[1].lowFloor).toBe(false);
  });
  it("빈 결과는 빈 배열", () => {
    expect(parseBusArrivals(fixture.empty)).toEqual([]);
  });
});

describe("parseBusRouteStops", () => {
  it("순번(nodeord) 오름차순으로 정렬", () => {
    const stops = parseBusRouteStops(fixture.routeStops);
    expect(stops.map((s) => s.order)).toEqual([1, 2]);
    expect(stops[0].name).toBe("부산역");
  });
});
