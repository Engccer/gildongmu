// 2026-06-14 실 TAGO 호출로 envelope·필드명·저상버스 판정 검증 완료(성남시청후문앞 등 실응답). fixture 구조가 실응답과 일치.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../env", () => ({
  env: { DATA_GO_KR_API_KEY: "test-key" },
}));

import fixture from "./fixtures/tago-bus.json";
import {
  parseTagoItems,
  haversineMeters,
  parseBusStops,
  parseBusArrivals,
  parseBusRouteStops,
  fetchNearbyBusStops,
  fetchBusRouteStops,
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
    expect(stops[0].source).toBe("tago");
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
    expect(arr[0].source).toBe("tago");
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

function mockFetchSequence(...payloads: unknown[]) {
  const fn = vi.fn();
  for (const p of payloads) {
    fn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(p),
    });
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchNearbyBusStops", () => {
  it("근접 정류소 + 각 정류소 도착정보를 병렬로 채운다", async () => {
    // 1) A-2 nearbyStops, 2) 정류소1 A-1, 3) 정류소2 A-1
    mockFetchSequence(fixture.nearbyStops, fixture.arrivals, fixture.empty);
    const stops = await fetchNearbyBusStops(35.1795, 129.0756);
    expect(stops.length).toBe(2);
    expect(stops[0].arrivalStatus).toBe("ok"); // 조회 성공
    expect(stops[0].arrivals.length).toBe(2); // fixture.arrivals
    expect(stops[1].arrivalStatus).toBe("ok"); // 조회 성공이나 도착 0건(= 정상 "버스 없음")
    expect(stops[1].arrivals).toEqual([]); // fixture.empty
  });

  it("도착조회 실패는 unavailable로 구분(빈 배열로 뭉개지 않음, 개정 노트 §1)", async () => {
    const fn = vi.fn();
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(fixture.nearbyStops) });
    fn.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" }); // 정류소1 도착조회 실패
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(fixture.arrivals) }); // 정류소2 성공
    vi.stubGlobal("fetch", fn);
    const stops = await fetchNearbyBusStops(35.1795, 129.0756);
    // 실패 → unavailable (≠ ok+빈배열). 정류소 자체(A-2)는 보존.
    expect(stops[0].arrivalStatus).toBe("unavailable");
    expect(stops[0].arrivals).toEqual([]);
    expect(stops[1].arrivalStatus).toBe("ok");
    expect(stops[1].arrivals.length).toBe(2);
  });

  it("totalCount가 받은 수보다 크면 페이징해 후보 전체를 수집(개정 노트 §3)", async () => {
    // page1에 2건(totalCount 3) → page2에 1건. "10건만 받아 슬라이스"였다면 S3을
    // 영영 못 보고 정렬한다. 페이징으로 3건을 다 모은 뒤 거리 정렬해야 한다.
    const page1 = { response: { header: { resultCode: "00" }, body: { totalCount: 3, items: { item: [
      { citycode: 23, gpslati: 35.1795, gpslong: 129.0756, nodeid: "S1", nodenm: "정류소1" },
      { citycode: 23, gpslati: 35.1796, gpslong: 129.0757, nodeid: "S2", nodenm: "정류소2" },
    ] } } } };
    const page2 = { response: { header: { resultCode: "00" }, body: { totalCount: 3, items: { item: [
      { citycode: 23, gpslati: 35.1797, gpslong: 129.0758, nodeid: "S3", nodenm: "정류소3" },
    ] } } } };
    const fn = vi.fn();
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(page1) });
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(page2) });
    // 정류소 3개의 도착조회(모두 빈결과)
    for (let i = 0; i < 3; i++) {
      fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(fixture.empty) });
    }
    vi.stubGlobal("fetch", fn);
    const stops = await fetchNearbyBusStops(35.1795, 129.0756);
    expect(stops.length).toBe(3); // page1 2건으로 끝내지 않고 page2까지 수집
    expect(stops.map((s) => s.nodeId)).toEqual(["S1", "S2", "S3"]); // 거리 오름차순
  });

  it("서비스 에러 envelope는 throw(정보 없음과 구분)", async () => {
    mockFetchSequence(fixture.serviceError);
    await expect(fetchNearbyBusStops(35.1795, 129.0756)).rejects.toThrow();
  });
});

describe("fetchBusRouteStops", () => {
  it("경유정류소를 순번 순으로 반환", async () => {
    mockFetchSequence(fixture.routeStops);
    const stops = await fetchBusRouteStops("23", "DGB3000");
    expect(stops.map((s) => s.order)).toEqual([1, 2]);
  });
});
