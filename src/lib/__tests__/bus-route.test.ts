// E87: 노선 번호 조회의 고르기(`lookupBusRoute`)와 답 재료(`describeBusRoute`). 외부 호출은 전부 가짜 deps다.
import { describe, it, expect, vi } from "vitest";

vi.mock("../env", () => ({ env: { DATA_GO_KR_API_KEY: "test-key" }, hasKakaoKey: () => true }));

import {
  BUS_ROUTE_BOARD_M,
  describeBusRoute,
  lookupBusRoute,
  matchLineStops,
  normalizeRouteNo,
  routeNoMatches,
  type BusRouteCandidate,
  type BusRouteDeps,
} from "../bus-route";
import type { BusLine, BusLineStop } from "../types";

const 서울시청 = { lat: 37.5663, lng: 126.9779 };
const 부산서면 = { lat: 35.1577, lng: 129.0592 };

function line(over: Partial<BusLine> = {}): BusLine {
  return {
    source: "seoul",
    routeId: "100100048",
    routeNo: "272",
    routeType: "간선버스",
    startStop: "면목동",
    endStop: "남가좌동",
    firstMinutes: 255,
    lastMinutes: 1350,
    intervalMinutes: 6,
    ...over,
  };
}

/** 왕복 노선: 가→나→다→라(회차)→다→나→가. 좌표는 위도만 0.001도(약 111m)씩 민다. */
function roundTrip(base: { lat: number; lng: number }, names = ["가동", "나역.나사거리", "다시장", "라종점"]): BusLineStop[] {
  const out: BusLineStop[] = [];
  names.forEach((name, i) =>
    out.push({ name, order: i + 1, lat: base.lat + i * 0.001, lng: base.lng, towards: "라종점", turnaround: i === names.length - 1 }),
  );
  [...names].reverse().slice(1).forEach((name, j) => {
    const i = names.length - 2 - j;
    out.push({ name, order: names.length + j + 1, lat: base.lat + i * 0.001, lng: base.lng + 0.0002, towards: "가동", turnaround: false });
  });
  return out;
}

function deps(over: Partial<BusRouteDeps> = {}): BusRouteDeps {
  return {
    region: async () => ({ province: "서울특별시", city: "중구" }),
    nearbyCityCodes: async () => [],
    searchSeoul: async () => [],
    searchTago: async () => [],
    seoulStops: async () => roundTrip(서울시청),
    tagoStops: async () => ({ stops: roundTrip(부산서면), truncated: false }),
    tagoInterval: async () => null,
    ...over,
  };
}

function candidate(over: Partial<BusRouteCandidate> = {}): BusRouteCandidate {
  return { line: line(), region: "서울", stops: roundTrip(서울시청), truncated: false, nearYou: true, ...over };
}

describe("노선 번호 정규화와 대조", () => {
  it("「번」「버스」 꼬리와 공백을 떼고 영문을 대문자로 맞춘다", () => {
    expect(normalizeRouteNo(" 272번 ")).toBe("272");
    expect(normalizeRouteNo("n62번 버스")).toBe("N62");
    expect(normalizeRouteNo("강동01")).toBe("강동01");
  });

  it("같은 번호와 한글 지역 꼬리만 붙은 이름만 같은 노선이다", () => {
    expect(routeNoMatches("272", "272")).toBe(true);
    expect(routeNoMatches("30-3하남", "30-3")).toBe(true);
    expect(routeNoMatches("2720", "272")).toBe(false);
    expect(routeNoMatches("1003(심야)", "1003")).toBe(false);
    expect(routeNoMatches("강동01", "01")).toBe(false);
    expect(routeNoMatches("272", "")).toBe(false);
  });
});

describe("matchLineStops", () => {
  const stops = roundTrip(서울시청, ["면목동", "강남역.강남역사거리", "강남구청", "명지대사거리.백련시장"]);
  const names = (q: string) => matchLineStops(stops, q).map((i) => stops[i].name);

  it("대표 이름·점으로 나뉜 조각이 같으면 그 정류소만 고른다(부분 일치로 넓히지 않는다)", () => {
    expect(new Set(names("강남역"))).toEqual(new Set(["강남역.강남역사거리"]));
    expect(new Set(names("백련시장 정류장"))).toEqual(new Set(["명지대사거리.백련시장"]));
  });

  it("정확한 것이 없으면 이름에 들어 있는 정류소 전부다", () => {
    expect(new Set(names("강남"))).toEqual(new Set(["강남역.강남역사거리", "강남구청"]));
  });

  it("없는 이름과 한 글자 질의는 빈 배열", () => {
    expect(names("시청")).toEqual([]);
    expect(names("동")).toEqual([]);
  });
});

describe("lookupBusRoute", () => {
  it("서울 좌표면 TAGO를 부르지 않고 서울 노선 하나를 고른다", async () => {
    const searchTago = vi.fn(async () => []);
    const nearbyCityCodes = vi.fn(async () => ["21"]);
    const r = await lookupBusRoute(
      { routeNo: "272", coord: 서울시청 },
      deps({ searchSeoul: async () => [line(), line({ routeNo: "2720", routeId: "x" })], searchTago, nearbyCityCodes }),
    );
    expect(r.kind).toBe("found");
    if (r.kind !== "found") return;
    expect(r.chosen.line.routeNo).toBe("272");
    expect(r.chosen.region).toBe("서울");
    expect(r.chosen.nearYou).toBe(true);
    expect(r.local).toBe("seoul");
    expect(searchTago).not.toHaveBeenCalled();
    expect(nearbyCityCodes).not.toHaveBeenCalled();
  });

  it("같은 번호가 서울과 지역에 있으면 기준 좌표 근처를 지나는 노선을 고르고 배차 간격을 채운다", async () => {
    const tagoInterval = vi.fn(async () => 10);
    const r = await lookupBusRoute(
      { routeNo: "1003", coord: 부산서면 },
      deps({
        region: async () => ({ province: "부산광역시", city: "부산진구" }),
        searchSeoul: async () => [line({ routeNo: "1003", routeId: "s" })],
        searchTago: async (code) => [
          line({ source: "tago", cityCode: code, routeId: "BSB1", routeNo: "1003", startStop: "기장교리", endStop: "부산대학병원", intervalMinutes: null }),
          line({ source: "tago", cityCode: code, routeId: "BSB2", routeNo: "1003(심야)", startStop: "기장교리", endStop: "부산대학병원" }),
        ],
        tagoInterval,
      }),
    );
    expect(r.kind).toBe("found");
    if (r.kind !== "found") return;
    expect(r.chosen.line.routeId).toBe("BSB1");
    expect(r.chosen.region).toBe("부산광역시");
    expect(r.chosen.line.intervalMinutes).toBe(10);
    expect(r.local).toBe("searched");
    expect(tagoInterval).toHaveBeenCalledWith("21", "BSB1");
  });

  const far = { lat: 36.35, lng: 127.38 }; // 대전(가짜 정류소들에서 멀다)
  const daejeon = { region: async () => ({ province: "대전광역시", city: "서구" }) };

  it("근처를 지나는 노선이 없으면 기준 위치 지역의 노선을 서울 노선보다 먼저 고른다", async () => {
    const r = await lookupBusRoute(
      { routeNo: "1", coord: far },
      deps({
        ...daejeon,
        searchSeoul: async () => [line({ routeNo: "1남양주", routeId: "s", startStop: "A", endStop: "B" })],
        searchTago: async (code) => [
          line({ source: "tago", cityCode: code, routeNo: "1", routeId: "t", startStop: "C", endStop: "D" }),
        ],
      }),
    );
    expect(r).toMatchObject({ kind: "found", chosen: { line: { routeId: "t" }, region: "대전광역시", nearYou: false } });
  });

  it("근처에도 없고 지역 노선도 여럿이면 고르지 않고 후보를 돌려준다", async () => {
    const r = await lookupBusRoute(
      { routeNo: "1", coord: far },
      deps({
        ...daejeon,
        searchSeoul: async () => [line({ routeNo: "1", routeId: "s", startStop: "A", endStop: "B" })],
        searchTago: async (code) => [
          line({ source: "tago", cityCode: code, routeNo: "1", routeId: "t1", startStop: "C", endStop: "D" }),
          line({ source: "tago", cityCode: code, routeNo: "1", routeId: "t2", startStop: "E", endStop: "F" }),
        ],
      }),
    );
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.candidates.map((c) => c.line.routeId)).toEqual(["t1", "t2"]);
    expect(r.candidates.every((c) => c.nearYou === false)).toBe(true);
  });

  it("지명에서 온 좌표(regionOnly)는 근처 노선 고르기에 쓰지 않는다 — 지역 노선이 여럿이면 되묻는다", async () => {
    const q = { routeNo: "1003", coord: 부산서면 };
    const two = deps({
      region: async () => ({ province: "부산광역시", city: "부산진구" }),
      searchTago: async (code) => [
        line({ source: "tago", cityCode: code, routeId: "near", routeNo: "1003", startStop: "A", endStop: "B" }),
        line({ source: "tago", cityCode: code, routeId: "far", routeNo: "1003", startStop: "C", endStop: "D" }),
      ],
      tagoStops: async (l) => ({ stops: roundTrip(l.routeId === "near" ? 부산서면 : { lat: 35.3, lng: 129.2 }), truncated: false }),
    });
    // 현재 위치면 근처를 지나는 쪽을 고른다.
    const here = await lookupBusRoute(q, two);
    expect(here.kind === "found" && here.chosen.line.routeId).toBe("near");
    // 지명이면 그 한 점으로 고르지 않는다.
    const named = await lookupBusRoute({ ...q, regionOnly: true }, two);
    expect(named.kind).toBe("ambiguous");
    if (named.kind !== "ambiguous") return;
    expect(named.candidates.every((c) => c.nearYou === null)).toBe(true);
    expect(named.more).toBeUndefined();
  });

  it("후보가 다섯을 넘으면 다섯만 싣고 더 있음을 남긴다", async () => {
    const r = await lookupBusRoute(
      { routeNo: "1" },
      deps({
        searchSeoul: async () =>
          Array.from({ length: 7 }, (_, i) => line({ routeNo: "1", routeId: `r${i}`, startStop: `기점${i}`, endStop: `종점${i}` })),
      }),
    );
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.candidates).toHaveLength(5);
    expect(r.more).toBe(true);
  });

  it("위치가 없고 서울 노선이 여럿이면 후보를 돌려주고, 지역 꼬리가 지역 이름이 된다", async () => {
    const r = await lookupBusRoute(
      { routeNo: "1003" },
      deps({
        searchSeoul: async () => [
          line({ routeNo: "1003", routeId: "a", startStop: "A", endStop: "B" }),
          line({ routeNo: "1003남양주", routeId: "b", startStop: "다산차고지", endStop: "잠실광역환승센터" }),
        ],
      }),
    );
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.candidates.map((c) => c.region)).toEqual(["서울", "남양주"]);
    expect(r.candidates.every((c) => c.nearYou === null)).toBe(true);
  });

  it("근처 노선이 여럿이면 타는 정류소 이름이 있는 노선으로 가른다", async () => {
    const r = await lookupBusRoute(
      { routeNo: "5", coord: 서울시청, fromStop: "바다공원" },
      deps({
        searchSeoul: async () => [
          line({ routeNo: "5", routeId: "a", startStop: "A", endStop: "B" }),
          line({ routeNo: "5", routeId: "b", startStop: "C", endStop: "D" }),
        ],
        seoulStops: async (id) => roundTrip(서울시청, id === "b" ? ["가동", "바다공원", "라종점"] : undefined),
      }),
    );
    expect(r.kind).toBe("found");
    if (r.kind === "found") expect(r.chosen.line.routeId).toBe("b");
  });

  it("TOPIS와 TAGO가 같은 노선(번호·기점·종점)을 주면 하나만 둔다", async () => {
    const r = await lookupBusRoute(
      { routeNo: "3000", coord: { lat: 37.26, lng: 127.03 } },
      deps({
        region: async () => ({ province: "경기도", city: "수원시 팔달구" }),
        nearbyCityCodes: async () => ["31010"],
        searchSeoul: async () => [line({ routeNo: "3000", routeId: "s", startStop: "수원역", endStop: "강남역" })],
        searchTago: async (code) => [
          line({ source: "tago", cityCode: code, routeNo: "3000", routeId: "t", startStop: "수원역", endStop: "강남역" }),
        ],
      }),
    );
    expect(r.kind).toBe("found");
    if (r.kind === "found") expect(r.chosen.line.source).toBe("seoul");
  });

  it("합칠 때 서울 쪽의 빈 첫차·막차는 TAGO 값으로 채운다(이름 꼬리가 달라도 기점·종점이 같으면 같은 노선)", async () => {
    const r = await lookupBusRoute(
      { routeNo: "1003", coord: { lat: 37.6, lng: 127.2 } },
      deps({
        region: async () => ({ province: "경기도", city: "남양주시" }),
        searchSeoul: async () => [
          line({ routeNo: "1003남양주", routeId: "s", routeType: "", startStop: "다산차고지", endStop: "잠실광역환승센터", firstMinutes: null, lastMinutes: null, intervalMinutes: 30 }),
        ],
        searchTago: async (code) => [
          line({ source: "tago", cityCode: code, routeNo: "1003", routeId: "t", routeType: "직행좌석버스", startStop: "다산차고지", endStop: "잠실광역환승센터", firstMinutes: 300, lastMinutes: 1380, intervalMinutes: null }),
        ],
      }),
    );
    expect(r).toMatchObject({
      kind: "found",
      chosen: { region: "남양주", line: { routeId: "s", routeType: "직행좌석버스", firstMinutes: 300, lastMinutes: 1380, intervalMinutes: 30 } },
    });
  });

  it("같은 번호가 없으면 notFound이고 비슷한 번호를 싣는다", async () => {
    const r = await lookupBusRoute(
      { routeNo: "27", coord: 서울시청 },
      deps({ searchSeoul: async () => [line(), line({ routeNo: "2720", routeId: "x" })] }),
    );
    expect(r).toEqual({ kind: "notFound", similar: ["272", "2720"], local: "seoul" });
  });

  it("지역 범위: 좌표 없음·TAGO 미제공 지역·지역 판정 불가를 가른다", async () => {
    const none = await lookupBusRoute({ routeNo: "9" }, deps());
    expect(none).toMatchObject({ kind: "notFound", local: "noLocation" });
    const gangneung = await lookupBusRoute(
      { routeNo: "9", coord: { lat: 37.7547, lng: 128.8789 } },
      deps({ region: async () => ({ province: "강원특별자치도", city: "강릉시" }) }),
    );
    expect(gangneung).toMatchObject({ kind: "notFound", local: "uncovered" });
    const unknown = await lookupBusRoute({ routeNo: "9", coord: 부산서면 }, deps({ region: async () => null }));
    expect(unknown).toMatchObject({ kind: "notFound", local: "unknown" });
  });

  it("번호 검색이 실패했는데 찾은 노선이 없으면 throw다(실패를 없음으로 접지 않는다)", async () => {
    await expect(
      lookupBusRoute(
        { routeNo: "272", coord: 서울시청 },
        deps({
          searchSeoul: async () => {
            throw new Error("headerCd 7");
          },
        }),
      ),
    ).rejects.toThrow("버스 노선 조회 실패");
  });

  it("한쪽 검색이 실패해도 다른 쪽에서 찾았으면 답하고 실패한 쪽을 남긴다", async () => {
    const r = await lookupBusRoute(
      { routeNo: "1003", coord: 부산서면 },
      deps({
        region: async () => ({ province: "부산광역시", city: "부산진구" }),
        searchSeoul: async () => {
          throw new Error("down");
        },
        searchTago: async (code) => [line({ source: "tago", cityCode: code, routeNo: "1003", routeId: "t" })],
      }),
    );
    expect(r).toMatchObject({ kind: "found", searchFailed: ["seoul"] });
  });

  it("경유 정류소 조회가 실패하거나 비면 노선은 고르되 정류소는 null이다", async () => {
    const r = await lookupBusRoute(
      { routeNo: "272", coord: 서울시청 },
      deps({
        searchSeoul: async () => [line()],
        seoulStops: async () => {
          throw new Error("down");
        },
      }),
    );
    expect(r).toMatchObject({ kind: "found", chosen: { stops: null, nearYou: null } });
    const empty = await lookupBusRoute({ routeNo: "272" }, deps({ searchSeoul: async () => [line()], seoulStops: async () => [] }));
    expect(empty).toMatchObject({ kind: "found", chosen: { stops: null } });
  });
});

describe("describeBusRoute", () => {
  it("노선 머리: 기점·종점·회차 지점·첫차·막차·배차 간격·정류소 수", () => {
    const d = describeBusRoute(candidate(), { roman: false });
    expect(d.route).toEqual({
      routeNo: "272",
      region: "서울",
      routeType: "간선버스",
      startStop: "면목동",
      endStop: "남가좌동",
      passesNearYou: true,
      turnaroundStop: "라종점",
      firstBus: "04:15",
      lastBus: "22:30",
      intervalMinutes: 6,
      stopCount: 7,
    });
  });

  it("지역 꼬리가 붙은 노선 이름은 번호만 남기고 꼬리는 region이 말한다", () => {
    const d = describeBusRoute(candidate({ line: line({ routeNo: "1003남양주" }), region: "남양주" }), { roman: false });
    expect(d.route).toMatchObject({ routeNo: "1003", region: "남양주" });
  });

  it("첫차·막차·배차 간격을 모르면 null로 남긴다(0이나 빈 문자열로 접지 않는다)", () => {
    const d = describeBusRoute(candidate({ line: line({ firstMinutes: null, lastMinutes: null, intervalMinutes: null }) }), { roman: false });
    expect(d.route).toMatchObject({ firstBus: null, lastBus: null, intervalMinutes: null });
  });

  it("타는 곳도 가려는 곳도 모르면 기점에서 회차 지점까지의 일부만 싣는다", () => {
    const d = describeBusRoute(candidate({ nearYou: null }), { roman: false });
    expect(d.someStops).toEqual({ towards: "라종점", stops: ["나역.나사거리", "다시장"] });
    expect(d.boarding).toBeUndefined();
  });

  it("타는 곳에서 그 방면으로 몇 정류장인지 센다 — 방면이 맞는 쪽만 남긴다", () => {
    const d = describeBusRoute(candidate(), { fromStop: "나역", toStop: "라종점", roman: false });
    expect(d.toStop).toEqual({ query: "라종점", onRoute: true, stops: [{ name: "라종점", towards: "라종점" }] });
    expect(d.rides).toEqual([{ boardAt: "나역.나사거리", towards: "라종점", alightAt: "라종점", stopsAway: 2 }]);
  });

  it("가려는 정류소를 물었으면 그 답이 노선 머리보다 앞에 온다(묻지 않았으면 머리가 앞)", () => {
    const asked = describeBusRoute(candidate(), { fromStop: "나역", toStop: "라종점", roman: false });
    expect(Object.keys(asked)).toEqual(["rides", "toStop", "boarding", "route"]);
    expect(Object.keys(describeBusRoute(candidate(), { roman: false }))[0]).toBe("route");
  });

  it("반대 방면으로 가는 곳은 반대편 정류소에서 탄 줄만 남긴다(회차 지점을 도는 줄은 버린다)", () => {
    const d = describeBusRoute(candidate(), { fromStop: "다시장", toStop: "가동", roman: false });
    expect(d.rides).toEqual([{ boardAt: "다시장", towards: "가동", alightAt: "가동", stopsAway: 2 }]);
  });

  it("회차 지점을 돌아야만 닿으면 그 줄을 viaTurnaround로 남긴다", () => {
    const stops = roundTrip(서울시청).filter((s) => !(s.name === "가동" && s.towards === "라종점"));
    // 「나역」은 종점 방면에만, 「가동」은 기점 방면에만 있다.
    const oneSided = stops.filter((s) => !(s.name === "나역.나사거리" && s.towards === "가동"));
    const d = describeBusRoute(candidate({ stops: oneSided }), { fromStop: "나역", toStop: "가동", roman: false });
    expect(d.rides).toEqual([
      { boardAt: "나역.나사거리", towards: "라종점", alightAt: "가동", stopsAway: 4, viaTurnaround: true },
    ]);
  });

  it("타는 곳에서 이미 지난 정류소면 빈 rides 대신 behindBoarding을 싣는다(회차 없는 편도 노선)", () => {
    const oneWay = ["가동", "나역", "다시장", "라종점"].map((name, i) => ({
      name,
      order: i + 1,
      lat: 37.5663 + i * 0.001,
      lng: 126.9779,
      towards: "라종점",
      turnaround: false,
    }));
    const d = describeBusRoute(candidate({ stops: oneWay }), { fromStop: "다시장", toStop: "가동", roman: false });
    expect(d.rides).toBeUndefined();
    expect(d.toStop).toMatchObject({ onRoute: true, behindBoarding: true });
  });

  it("기점과 종점 이름이 같아 방면 이름이 양쪽 같아도 회차 지점을 넘으면 viaTurnaround다", () => {
    const loop = roundTrip(서울시청).map((s) => ({ ...s, towards: "가동" }));
    const d = describeBusRoute(candidate({ stops: loop }), { fromStop: "다시장", toStop: "가동", roman: false });
    // 가는 길의 다시장(3번째)에서는 회차 지점을 돌아 4정류장, 오는 길의 다시장(5번째)에서는 곧장 2정류장: 곧장 가는 줄만 남는다.
    expect(d.rides).toEqual([{ boardAt: "다시장", towards: "가동", alightAt: "가동", stopsAway: 2 }]);
  });

  it("가려는 정류소가 노선에 없으면 onRoute false이고 rides를 만들지 않는다", () => {
    const d = describeBusRoute(candidate(), { fromStop: "나역", toStop: "서울역", roman: false });
    expect(d.toStop).toEqual({ query: "서울역", onRoute: false });
    expect(d.rides).toBeUndefined();
    // 대신 어디를 지나는지 일부를 싣는다.
    expect(d.someStops).toEqual({ towards: "라종점", stops: ["나역.나사거리", "다시장"] });
  });

  it("타는 정류소 이름이 노선에 없으면 그 사실을 싣고 정류장 수는 세지 않는다", () => {
    const d = describeBusRoute(candidate(), { fromStop: "서울역", toStop: "다시장", roman: false });
    expect(d.fromStop).toEqual({ query: "서울역", onRoute: false });
    expect(d.toStop).toMatchObject({ onRoute: true });
    expect(d.rides).toBeUndefined();
  });

  it("타는 곳을 말하지 않으면 기준 좌표에서 가까운 정류소를 방면별로 하나씩 잡는다", () => {
    const d = describeBusRoute(candidate(), { coord: 서울시청, toStop: "다시장", roman: false });
    const boarding = d.boarding as { stop: string; towards: string; distanceMeters: number }[];
    expect(boarding.map((b) => [b.stop, b.towards])).toEqual([
      ["가동", "라종점"],
      ["가동", "가동"],
    ]);
    expect(boarding.every((b) => b.distanceMeters <= BUS_ROUTE_BOARD_M)).toBe(true);
    expect(d.rides).toEqual([{ boardAt: "가동", towards: "라종점", alightAt: "다시장", stopsAway: 2 }]);
  });

  it("기준 좌표가 정류소에서 멀면 타는 곳을 짐작하지 않는다", () => {
    const d = describeBusRoute(candidate(), { coord: 부산서면, toStop: "다시장", roman: false });
    expect(d.boarding).toBeUndefined();
    expect(d.rides).toBeUndefined();
    expect(d.toStop).toMatchObject({ onRoute: true });
  });

  it("가려는 곳을 묻지 않았고 타는 곳이 있으면 다음 정류소 몇 개를 방면별로 싣는다", () => {
    const d = describeBusRoute(candidate(), { fromStop: "나역", roman: false });
    expect(d.nextStops).toEqual([
      { boardAt: "나역.나사거리", towards: "라종점", stops: ["다시장", "라종점", "다시장", "나역.나사거리", "가동"] },
      { boardAt: "나역.나사거리", towards: "가동", stops: ["가동"] },
    ]);
    expect(d.someStops).toBeUndefined();
  });

  it("정류소를 받지 못했으면 unavailable, 일부만 받았으면 stopsIncomplete다", () => {
    expect(describeBusRoute(candidate({ stops: null, nearYou: null }), { toStop: "다시장", roman: false })).toMatchObject({
      stops: "unavailable",
    });
    expect(describeBusRoute(candidate({ truncated: true }), { roman: false })).toMatchObject({ stopsIncomplete: true });
  });

  it("좌표를 내보내지 않는다", () => {
    const d = describeBusRoute(candidate(), { coord: 서울시청, fromStop: "나역", toStop: "라종점", roman: false });
    expect(JSON.stringify(d)).not.toMatch(/"lat"|"lng"|37\.56|126\.97/);
  });

  it("영어 데이터 로케일이면 이름을 「로마자 (한글)」로 낸다", () => {
    const d = describeBusRoute(candidate(), { roman: true });
    expect((d.route as { startStop: string }).startStop).toMatch(/^[A-Za-z-]+ \(면목동\)$/);
  });
});
