// K3 ⑤ — 길찾기 3도구의 경유지(via) 인자.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

const HOME = { lat: 37.5378, lng: 127.1417 };
const CHEONHO = { lat: 37.5384, lng: 127.1237, name: "천호역" };
const YEOUIDO = { lat: 37.5219, lng: 126.9245, name: "여의도역" };

vi.mock("@/lib/providers/places", () => ({ searchPlaces: vi.fn() }));
vi.mock("@/lib/walk-route", () => ({ getWalkRoute: vi.fn() }));
vi.mock("@/lib/car-route", () => ({ getCarRoute: vi.fn() }));
vi.mock("@/lib/providers/odsay", () => ({ getTransitRoute: vi.fn() }));
vi.mock("@/lib/env", async (orig) => ({
  ...(await orig<typeof import("@/lib/env")>()),
  hasWalkRouteKey: () => true,
  hasNcpMapsKeys: () => true,
}));
vi.mock("@/lib/providers/ncp-directions", () => ({ getCarRouteBriefingEn: vi.fn(async () => ({ guides: [] })) }));

import { executeFunction } from "../router";
import { searchPlaces } from "@/lib/providers/places";
import { getWalkRoute } from "@/lib/walk-route";
import { getCarRoute } from "@/lib/car-route";
import { getTransitRoute } from "@/lib/providers/odsay";

const mockSearch = vi.mocked(searchPlaces);
const mockWalk = vi.mocked(getWalkRoute);
const mockCar = vi.mocked(getCarRoute);
const mockTransit = vi.mocked(getTransitRoute);
const ctx: ExecutionContext = { locale: "ko", dataLocale: "ko", userLocation: HOME };

const WALK = {
  distanceMeters: 3000,
  durationSeconds: 2400,
  steps: [{ description: "안전" }, { description: "직진" }, { description: "경유지" }, { description: "도착" }],
  waypoint: { stepIndex: 2, coord: CHEONHO },
};
const CAR = { distanceMeters: 9000, durationSeconds: 900, guides: [], waypoint: { stepIndex: 3, coord: CHEONHO } };

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockImplementation(async ({ query }) => ({
    places: query === "천호역" ? [CHEONHO] : query === "여의도역" ? [YEOUIDO] : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
  mockWalk.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockWalk.mockResolvedValue(WALK as any);
  mockCar.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockCar.mockResolvedValue(CAR as any);
  mockTransit.mockReset();
});

describe("get_walk_route via", () => {
  it("경유지 좌표를 서비스에 넘기고 via{name,stepIndex}를 싣는다", async () => {
    const r = await executeFunction("get_walk_route", { destination: "여의도역", via: "천호역" }, ctx);
    expect(mockWalk).toHaveBeenCalledWith(expect.objectContaining({ via: { name: "천호역", lat: CHEONHO.lat, lng: CHEONHO.lng } }));
    expect((r.data as { via: unknown }).via).toEqual({ name: "천호역", stepIndex: 2 });
  });

  it("경유지 없으면 via를 넘기지 않고 data에도 없다", async () => {
    const r = await executeFunction("get_walk_route", { destination: "여의도역" }, ctx);
    expect(mockWalk.mock.calls[0][0].via).toBeUndefined();
    expect((r.data as { via?: unknown }).via).toBeUndefined();
  });

  it("경유지 도착 스텝은 20개 절단 밖에 두지 않는다 — stepIndex가 받은 배열을 벗어나면 날조 유도", async () => {
    const steps = Array.from({ length: 30 }, (_, i) => ({ description: `s${i}` }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockWalk.mockResolvedValue({ ...WALK, steps, waypoint: { stepIndex: 25, coord: CHEONHO } } as any);
    const r = await executeFunction("get_walk_route", { destination: "여의도역", via: "천호역" }, ctx);
    const d = r.data as { steps: unknown[]; via: { stepIndex: number }; truncated?: boolean };
    expect(d.steps).toHaveLength(26);
    expect(d.via.stepIndex).toBe(25);
    expect(d.truncated).toBe(true);
  });

  it("경유지 해석 실패는 error — 경유 없는 경로로 대체하지 않는다", async () => {
    const r = await executeFunction("get_walk_route", { destination: "여의도역", via: "없는곳" }, ctx);
    expect(mockWalk).not.toHaveBeenCalled();
    expect((r.data as { error: string }).error).toContain("없는곳");
  });
});

describe("get_car_route via", () => {
  it("경유지를 넘기고 카드는 내지 않는다(카드는 경유 없는 경로를 self-fetch)", async () => {
    const r = await executeFunction("get_car_route", { destination: "여의도역", via: "천호역" }, ctx);
    expect(mockCar).toHaveBeenCalledWith(expect.objectContaining({ via: expect.objectContaining(CHEONHO) }));
    expect(r.render).toBeUndefined();
    expect((r.data as { via: unknown }).via).toEqual({ name: "천호역", stepIndex: 3 });
  });

  it("en(NCP) + 경유지는 한국어 안내로 내리지 않고 unsupported 마커 — upstream 미호출", async () => {
    const r = await executeFunction("get_car_route", { destination: "여의도역", via: "천호역" }, { ...ctx, dataLocale: "en" });
    expect(mockCar).not.toHaveBeenCalled();
    expect((r.data as { unsupported?: string }).unsupported).toBe("waypoint");
    expect(r.render).toBeUndefined();
  });

  it("경유지 없으면 카드를 낸다(기존 동작 불변)", async () => {
    const r = await executeFunction("get_car_route", { destination: "여의도역" }, ctx);
    expect(r.render?.type).toBe("car-route");
  });
});

describe("get_transit_route via", () => {
  it("ODsay 미호출, unsupported:waypoint 마커 — route:null만 주면 경로 없음으로 위장", async () => {
    const r = await executeFunction("get_transit_route", { destination: "여의도역", via: "천호역" }, ctx);
    expect(mockTransit).not.toHaveBeenCalled();
    const d = r.data as { route: unknown; unsupported: string; destination: string };
    expect(d.route).toBeNull();
    expect(d.unsupported).toBe("waypoint");
    expect(d.destination).toBe("여의도역");
    expect(r.render).toBeUndefined();
  });
});
