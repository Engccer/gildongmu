import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

const 강릉 = { lat: 37.7547, lng: 128.8789 }; // 시외버스터미널
const 길동 = { lat: 37.5385, lng: 127.1435 };

// 정류소 조회와 지역 판정만 모킹한다(둘 다 외부 호출). 판정 규칙 자체는 실제
// 구현을 쓰는 라우트 테스트가 덮으므로 여기서는 **호출 조건**을 본다.
vi.mock("@/lib/bus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bus")>()),
  fetchNearbyBusStops: vi.fn(),
  isUncoveredBusRegion: vi.fn(),
}));

import { executeFunction } from "../router";
import { fetchNearbyBusStops, isUncoveredBusRegion } from "@/lib/bus";

const mockStops = vi.mocked(fetchNearbyBusStops);
const mockUncovered = vi.mocked(isUncoveredBusRegion);

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return { locale: "ko", dataLocale: "ko", ...over };
}

/**
 * `count: 0`을 그대로 넘기면 LLM이 "근처에 정류소가 없습니다"로 요약하는데, 강릉처럼
 * 터미널 앞에서도 0건인 지역에서 그 문장은 거짓이다.
 */
describe("get_bus_arrivals (채팅 도구) 미커버 지역", () => {
  beforeEach(() => {
    mockStops.mockReset();
    mockUncovered.mockReset();
    mockUncovered.mockResolvedValue(false);
  });

  it("0건 + 미커버 지역이면 count가 아니라 미제공 사유를 넘긴다", async () => {
    mockStops.mockResolvedValue([]);
    mockUncovered.mockResolvedValue(true);
    const r = await executeFunction("get_bus_arrivals", {}, ctx({ userLocation: 강릉 }));
    const data = r.data as { unavailableHere?: string; notice?: string; count?: number };
    expect(data.unavailableHere).toBe("noBusData");
    expect(data.notice).toContain("데이터가 없다");
    expect(data.count).toBeUndefined();
    // 카드까지 붙이면 빈 목록이 렌더되어 산문과 어긋난다.
    expect(r.render).toBeUndefined();
  });

  it("0건이지만 커버 지역이면 평소대로 count 0: 반경 밖은 미제공이 아니다", async () => {
    mockStops.mockResolvedValue([]);
    const r = await executeFunction("get_bus_arrivals", {}, ctx({ userLocation: 강릉 }));
    expect(r.data).toMatchObject({ count: 0 });
    expect(r.data).not.toHaveProperty("unavailableHere");
  });

  it("정류소가 있으면 지역 판정을 아예 부르지 않는다: 담양 회귀 가드", async () => {
    // 담양은 TAGO 도시코드가 없지만 광주 버스가 넘어와 정류소가 잡힌다. 사전 판정하면
    // 거짓 "미제공"이 나가므로 판정은 0건일 때만 발동해야 한다.
    mockStops.mockResolvedValue([{ name: "담양군청" }] as never);
    const r = await executeFunction("get_bus_arrivals", {}, ctx({ userLocation: 길동 }));
    expect(r.data).toMatchObject({ count: 1 });
    expect(mockUncovered).not.toHaveBeenCalled();
  });
});
