// E87: 채팅 도구 `get_bus_route`의 실행부. 노선 고르기는 모킹하고(`bus-route.test.ts`가 덮는다) 여기서는 인자 해석·3-state·카드 없음을 본다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";
import type { BusRouteCandidate } from "@/lib/bus-route";

vi.mock("@/lib/bus-route", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bus-route")>()),
  lookupBusRoute: vi.fn(),
}));
vi.mock("@/lib/providers/places", () => ({ searchPlaces: vi.fn() }));

import { executeFunction } from "../router";
import { lookupBusRoute } from "@/lib/bus-route";
import { searchPlaces } from "@/lib/providers/places";

const mockLookup = vi.mocked(lookupBusRoute);
const mockSearch = vi.mocked(searchPlaces);

const 길동 = { lat: 37.5385, lng: 127.1435 };

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return { locale: "ko", dataLocale: "ko", ...over };
}

const chosen: BusRouteCandidate = {
  line: {
    source: "seoul",
    routeId: "100100048",
    routeNo: "272",
    routeType: "간선버스",
    startStop: "면목동",
    endStop: "남가좌동",
    firstMinutes: 255,
    lastMinutes: 1350,
    intervalMinutes: 6,
  },
  region: "서울",
  stops: [
    { name: "면목동", order: 1, lat: 37.57, lng: 127.08, towards: "남가좌동", turnaround: false },
    { name: "안국역", order: 2, lat: 37.576, lng: 126.985, towards: "남가좌동", turnaround: false },
    { name: "남가좌동", order: 3, lat: 37.57, lng: 126.92, towards: "남가좌동", turnaround: true },
  ],
  truncated: false,
  nearYou: false,
};

describe("get_bus_route (채팅 도구)", () => {
  beforeEach(() => {
    mockLookup.mockReset();
    mockSearch.mockReset();
  });

  it("번호가 비면 조회하지 않는다", async () => {
    const r = await executeFunction("get_bus_route", { routeNo: " 번 " }, ctx());
    expect(r.data).toEqual({ error: "노선 번호가 필요합니다." });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("번호를 정규화해 넘기고, 찾은 노선은 카드 없이 글 재료와 출처만 돌려준다", async () => {
    mockLookup.mockResolvedValue({ kind: "found", chosen, local: "seoul", searchFailed: [] });
    const r = await executeFunction("get_bus_route", { routeNo: "272번", toStop: "안국역" }, ctx({ userLocation: 길동 }));
    expect(mockLookup).toHaveBeenCalledWith({ routeNo: "272", coord: 길동, fromStop: undefined }, expect.anything());
    expect(r.render).toBeUndefined();
    expect((r.data as { searched?: string }).searched).toBeUndefined();
    expect(r.source).toEqual([{ label: "source.tago" }]);
    expect(r.data).toMatchObject({
      route: { routeNo: "272", region: "서울", passesNearYou: false, firstBus: "04:15", lastBus: "22:30" },
      toStop: { query: "안국역", onRoute: true },
    });
    // 좌표는 모델에 가지 않는다.
    expect(JSON.stringify(r.data)).not.toMatch(/"lat"|"lng"/);
  });

  it("위치가 없어도 답한다(좌표 없이 조회)", async () => {
    mockLookup.mockResolvedValue({ kind: "found", chosen: { ...chosen, nearYou: null }, local: "noLocation", searchFailed: [] });
    const r = await executeFunction("get_bus_route", { routeNo: "272" }, ctx());
    expect(mockLookup).toHaveBeenCalledWith({ routeNo: "272", coord: undefined, fromStop: undefined }, expect.anything());
    expect(r.data).toMatchObject({ route: { routeNo: "272" } });
    // 찾았어도 못 본 지역이 있으면 범위를 싣는다(더 맞는 노선이 그 지역에 있을 수 있다).
    expect((r.data as { searched: string }).searched).toContain("현재 위치를 몰라");
  });

  it("한국 밖 좌표는 기준으로 쓰지 않는다(번호 조회는 계속한다)", async () => {
    mockLookup.mockResolvedValue({ kind: "notFound", similar: [], local: "noLocation" });
    await executeFunction("get_bus_route", { routeNo: "272" }, ctx({ userLocation: { lat: 33.59, lng: 130.4 } }));
    expect(mockLookup).toHaveBeenCalledWith(expect.objectContaining({ coord: undefined }), expect.anything());
  });

  it("지명을 주면 그 좌표를 기준으로 하고 해석된 장소를 되돌린다", async () => {
    mockSearch.mockResolvedValue({
      places: [{ name: "부산시청", lat: 35.1796, lng: 129.0756, roadAddress: "부산 연제구 중앙대로 1001" }],
    } as never);
    mockLookup.mockResolvedValue({ kind: "notFound", similar: ["1003(심야)"], local: "searched" });
    const r = await executeFunction("get_bus_route", { routeNo: "1003", place: "부산" }, ctx({ userLocation: 길동 }));
    expect(mockLookup).toHaveBeenCalledWith(
      expect.objectContaining({ coord: expect.objectContaining({ lat: 35.1796, lng: 129.0756 }) }),
      expect.anything(),
    );
    expect(r.data).toEqual({
      resolvedPlace: "부산시청 (부산 연제구 중앙대로 1001)",
      found: false,
      routeNo: "1003",
      searched: "서울 버스와 기준 위치 지역의 버스에서 찾았습니다.",
      similarRouteNos: ["1003(심야)"],
    });
  });

  it("지명으로 푼 좌표로는 타는 정류소도 「근처를 지난다」도 말하지 않는다(지역을 가리는 데만 쓴다)", async () => {
    mockSearch.mockResolvedValue({ places: [{ name: "면목역", lat: 37.57, lng: 127.08 }] } as never);
    mockLookup.mockResolvedValue({ kind: "found", chosen: { ...chosen, nearYou: true }, local: "seoul", searchFailed: [] });
    const r = await executeFunction("get_bus_route", { routeNo: "272", place: "면목" }, ctx({ userLocation: 길동 }));
    const data = r.data as { route: Record<string, unknown>; boarding?: unknown; nextStops?: unknown; someStops?: unknown };
    expect(data.route.passesNearYou).toBeUndefined();
    expect(data.boarding).toBeUndefined();
    expect(data.nextStops).toBeUndefined();
    expect(data.someStops).toBeDefined();
  });

  it("지명 해석에 실패하면 현재 위치로 대신하지 않는다", async () => {
    mockSearch.mockResolvedValue({ places: [] } as never);
    const r = await executeFunction("get_bus_route", { routeNo: "1003", place: "없는곳" }, ctx({ userLocation: 길동 }));
    expect(r.data).toEqual({ error: "'없는곳' 위치를 찾지 못했습니다." });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("없음(0건)은 찾아본 범위를 함께 싣는다 — 못 본 지역을 없다고 하지 않는다", async () => {
    mockLookup.mockResolvedValue({ kind: "notFound", similar: [], local: "uncovered" });
    const r = await executeFunction("get_bus_route", { routeNo: "99999" }, ctx({ userLocation: { lat: 37.7547, lng: 128.8789 } }));
    const data = r.data as { found: boolean; searched: string; similarRouteNos?: string[] };
    expect(data.found).toBe(false);
    expect(data.searched).toContain("제공되지 않습니다");
    expect(data.similarRouteNos).toBeUndefined();
  });

  it("기준 위치 지역이 미제공이면 서울에서 찾은 후보 앞에 그 사실과 범위를 싣는다(강릉 202번 실호출)", async () => {
    mockLookup.mockResolvedValue({ kind: "ambiguous", candidates: [chosen, chosen], local: "uncovered", searchFailed: [] });
    const r = await executeFunction("get_bus_route", { routeNo: "202" }, ctx({ userLocation: { lat: 37.7547, lng: 128.8789 } }));
    expect(Object.keys(r.data as object).slice(0, 2)).toEqual(["unavailableHere", "searched"]);
    expect(r.data).toMatchObject({ unavailableHere: "noBusData" });
  });

  it("고르지 못하면 후보의 기점·종점·지역을 돌려준다(모델이 되묻는다)", async () => {
    mockLookup.mockResolvedValue({
      kind: "ambiguous",
      candidates: [chosen, { ...chosen, region: "부산광역시", line: { ...chosen.line, source: "tago", startStop: "기장", endStop: "서면" } }],
      local: "searched",
      searchFailed: ["tago"],
    });
    const r = await executeFunction("get_bus_route", { routeNo: "272" }, ctx({ userLocation: 길동 }));
    expect(r.data).toEqual({
      routeNo: "272",
      candidates: [
        { routeNo: "272", region: "서울", routeType: "간선버스", startStop: "면목동", endStop: "남가좌동", passesNearYou: false },
        { routeNo: "272", region: "부산광역시", routeType: "간선버스", startStop: "기장", endStop: "서면", passesNearYou: false },
      ],
      searchIncomplete: true,
    });
  });

  it("조회 실패는 throw로 올린다(루프가 실패로 전한다)", async () => {
    mockLookup.mockRejectedValue(new Error("버스 노선 조회 실패: seoul"));
    await expect(executeFunction("get_bus_route", { routeNo: "272" }, ctx())).rejects.toThrow("버스 노선 조회 실패");
  });
});
