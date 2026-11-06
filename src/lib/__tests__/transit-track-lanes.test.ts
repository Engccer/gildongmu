import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/seoul-bus", async (orig) => {
  const actual = await orig<typeof import("../providers/seoul-bus")>();
  return { ...actual, fetchSeoulStopRoutes: vi.fn(), fetchSeoulRouteStops: vi.fn() };
});
vi.mock("../providers/bus-service-hours", async (orig) => {
  const actual = await orig<typeof import("../providers/bus-service-hours")>();
  return { ...actual, fetchServiceHoursMap: vi.fn(async () => new Map()) };
});
vi.mock("../providers/tago-bus", async (orig) => {
  const actual = await orig<typeof import("../providers/tago-bus")>();
  return { ...actual, fetchTagoArrivals: vi.fn() };
});

import { fetchSeoulRouteStops, fetchSeoulStopRoutes } from "../providers/seoul-bus";
import { fetchServiceHoursMap } from "../providers/bus-service-hours";
import { fetchTagoArrivals } from "../providers/tago-bus";
import {
  SEOUL_LANES_DAILY_MISS_BUDGET,
  resetSeoulLanesMemoForTest,
  trackSeoulLanes,
  trackTago,
} from "../transit-track";
import type { BusRouteStop } from "../types";

/** E76 후속(spec `2026-11-07-e76-followup-design.md` §2.3 재기준 집합 · §4 지방버스 집합). */
afterEach(() => {
  vi.clearAllMocks();
  resetSeoulLanesMemoForTest();
});

const stops = (...ids: string[]): BusRouteStop[] =>
  ids.map((nodeId, i) => ({ nodeId, name: nodeId, order: i + 1, lat: 37.5, lng: 127 }));

const BASE = { arsId: "13045", boardLocalId: "B", alightLocalId: "A", routeId: "R0", lang: "ko" as const };

describe("trackSeoulLanes — 지금 서 있는 정류소 기준 집합(ⓔ)", () => {
  it("지금 노선·예약 노선을 빼고, 정류소 뒤에 하차 정류소가 오는 노선만 응답 순서대로 낸다", async () => {
    vi.mocked(fetchSeoulStopRoutes).mockResolvedValue([
      { routeId: "R0", routeNo: "271" },
      { routeId: "R1", routeNo: "160" },
      { routeId: "R2", routeNo: "602" },
      { routeId: "R3", routeNo: "M4108(예약)" },
      { routeId: "R4", routeNo: "260" },
    ]);
    const byRoute: Record<string, BusRouteStop[]> = {
      R1: stops("X", "B", "Y", "A"),
      R2: stops("B", "Y", "Z"), // 하차 정류소 없음
      R4: stops("A", "X", "B", "Y", "A"), // 정류소 앞에도 하차 정류소가 있다 — 정류소 뒤의 A
    };
    vi.mocked(fetchSeoulRouteStops).mockImplementation(async (id) => byRoute[id] ?? []);
    const r = await trackSeoulLanes(BASE);
    expect(r.routes).toEqual([
      { routeId: "R1", lineName: "160" },
      { routeId: "R4", lineName: "260" },
    ]);
    expect(r.checked).toBe(3);
    expect(r.unverified).toBe(0);
    expect(vi.mocked(fetchSeoulRouteStops).mock.calls.map((c) => c[0]).sort()).toEqual(["R1", "R2", "R4"]);
  });

  it("방향이 반대인 노선(하차 정류소가 정류소보다 앞)은 집합 밖", async () => {
    vi.mocked(fetchSeoulStopRoutes).mockResolvedValue([{ routeId: "R1", routeNo: "160" }]);
    vi.mocked(fetchSeoulRouteStops).mockResolvedValue(stops("A", "Y", "B"));
    expect((await trackSeoulLanes(BASE)).routes).toEqual([]);
  });

  it("경유 조회가 실패한 노선은 빼고 unverified로 센다(모르면 다른 곳으로 갈 수 있다)", async () => {
    vi.mocked(fetchSeoulStopRoutes).mockResolvedValue([
      { routeId: "R1", routeNo: "160" },
      { routeId: "R2", routeNo: "260" },
    ]);
    vi.mocked(fetchSeoulRouteStops).mockImplementation(async (id) => {
      if (id === "R1") throw new Error("TOPIS");
      return stops("B", "A");
    });
    const r = await trackSeoulLanes(BASE);
    expect(r.routes).toEqual([{ routeId: "R2", lineName: "260" }]);
    expect(r.unverified).toBe(1);
  });

  it("정류소 조회 실패는 throw(라우트 502 — 단일 노선 대기가 계속된다)", async () => {
    vi.mocked(fetchSeoulStopRoutes).mockRejectedValue(new Error("TOPIS"));
    await expect(trackSeoulLanes(BASE)).rejects.toThrow();
  });

  it("정류소가 경유에 두 번 나오는 노선(순환·회차)은 회차를 못 가르므로 빼고 unverified로 센다(리뷰 H2)", async () => {
    vi.mocked(fetchSeoulStopRoutes).mockResolvedValue([{ routeId: "R1", routeNo: "160" }]);
    vi.mocked(fetchSeoulRouteStops).mockResolvedValue(stops("B", "A", "X", "B", "Y"));
    const r = await trackSeoulLanes(BASE);
    expect(r.routes).toEqual([]);
    expect(r.unverified).toBe(1);
  });

  it("메모리 캐시 적중은 예산을 쓰지 않고, 같은 날 같은 노선은 다시 부르지 않는다(리뷰 M2)", async () => {
    vi.mocked(fetchSeoulStopRoutes).mockResolvedValue([{ routeId: "R1", routeNo: "160" }]);
    vi.mocked(fetchSeoulRouteStops).mockResolvedValue(stops("B", "A"));
    await trackSeoulLanes(BASE);
    await trackSeoulLanes(BASE);
    expect(fetchSeoulRouteStops).toHaveBeenCalledTimes(1);
  });

  it("동시 요청은 한 호출로 합친다", async () => {
    vi.mocked(fetchSeoulStopRoutes).mockResolvedValue([{ routeId: "R1", routeNo: "160" }]);
    vi.mocked(fetchSeoulRouteStops).mockResolvedValue(stops("B", "A"));
    await Promise.all([trackSeoulLanes(BASE), trackSeoulLanes(BASE)]);
    expect(fetchSeoulRouteStops).toHaveBeenCalledTimes(1);
  });

  it("예산을 다 쓰면 미스는 부르지 않고 unverified(단일 노선 대기는 클라이언트에 그대로)", async () => {
    const n = SEOUL_LANES_DAILY_MISS_BUDGET + 2;
    vi.mocked(fetchSeoulStopRoutes).mockResolvedValue(
      Array.from({ length: n }, (_, i) => ({ routeId: `R${i + 1}`, routeNo: `${i + 1}` })),
    );
    vi.mocked(fetchSeoulRouteStops).mockResolvedValue(stops("B", "A"));
    const r = await trackSeoulLanes(BASE);
    expect(fetchSeoulRouteStops).toHaveBeenCalledTimes(SEOUL_LANES_DAILY_MISS_BUDGET);
    expect(r.unverified).toBe(2);
  });

  it("운행 시간 밖으로 판정된 노선만 뺀다(판정 불가는 남는다)", async () => {
    vi.mocked(fetchSeoulStopRoutes).mockResolvedValue([
      { routeId: "R1", routeNo: "N13" },
      { routeId: "R2", routeNo: "260" },
    ]);
    vi.mocked(fetchSeoulRouteStops).mockResolvedValue(stops("B", "A"));
    // 지금 시각과 무관하게 「밖」이 되도록 0분 길이 창을 하루 반대편에 둔다.
    const now = new Date();
    const kst = (now.getUTCHours() * 60 + now.getUTCMinutes() + 9 * 60) % 1440;
    const far = (kst + 720) % 1440;
    vi.mocked(fetchServiceHoursMap).mockResolvedValueOnce(new Map([["R1", { firstMinutes: far, lastMinutes: (far + 1) % 1440 }]]));
    expect((await trackSeoulLanes(BASE)).routes.map((r) => r.lineName)).toEqual(["260"]);
  });

  it("상한은 지금 노선 자리를 뺀 11개", async () => {
    vi.mocked(fetchSeoulStopRoutes).mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({ routeId: `R${i + 1}`, routeNo: `${100 + i}` })),
    );
    vi.mocked(fetchSeoulRouteStops).mockResolvedValue(stops("B", "A"));
    expect((await trackSeoulLanes(BASE)).routes).toHaveLength(11);
  });

  it("en: 한글 없는 번호만 lineNameEn을 싣는다", async () => {
    vi.mocked(fetchSeoulStopRoutes).mockResolvedValue([
      { routeId: "R1", routeNo: "N13" },
      { routeId: "R2", routeNo: "서대문05" },
    ]);
    vi.mocked(fetchSeoulRouteStops).mockResolvedValue(stops("B", "A"));
    expect((await trackSeoulLanes({ ...BASE, lang: "en" })).routes).toEqual([
      { routeId: "R1", lineName: "N13", lineNameEn: "N13" },
      { routeId: "R2", lineName: "서대문05" },
    ]);
  });
});

describe("trackTago — 노선 집합(ⓓ)", () => {
  const arrival = (routeNo: string, prev: number) => ({
    routeId: `id-${routeNo}`,
    routeNo,
    routeType: "",
    arrivalSeconds: 0,
    prevStationCount: prev,
    lowFloor: false,
    arrivalMessage: "",
    source: "tago" as const,
  });

  it("집합 폴은 그 노선들만, route를 싣고 잔여순 — rawCount는 필터 전", async () => {
    vi.mocked(fetchTagoArrivals).mockResolvedValue([
      arrival("102", 5),
      arrival("999", 1),
      arrival("105", 2),
    ] as never);
    const r = await trackTago({ cityCode: "25", nodeId: "N", routeNos: ["102", "105"], lang: "ko" });
    if (r.status !== "ok") throw new Error("ok 기대");
    expect(r.items.map((i) => [i.route, i.remainingStops])).toEqual([
      ["105", 2],
      ["102", 5],
    ]);
    expect(r.rawCount).toBe(3);
  });

  it("단일 노선 폴은 route가 없고 순서 그대로(byte-호환)", async () => {
    vi.mocked(fetchTagoArrivals).mockResolvedValue([arrival("102", 5), arrival("102", 1)] as never);
    const r = await trackTago({ cityCode: "25", nodeId: "N", routeNo: "102", lang: "ko" });
    if (r.status !== "ok") throw new Error("ok 기대");
    expect(r.items.map((i) => i.remainingStops)).toEqual([5, 1]);
    expect(r.items.every((i) => !("route" in i))).toBe(true);
  });
});
