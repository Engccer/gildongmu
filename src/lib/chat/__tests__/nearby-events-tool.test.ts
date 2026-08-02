import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

const SEOUL = { lat: 37.5665, lng: 126.978 };
const TOKYO = { lat: 35.6762, lng: 139.6503 };

// isEventServiceArea는 실제 구현(순수 좌표 판정) — 모킹하면 지역 게이트가
// 라우트와 같은 판정선을 쓰는지 검증하지 못한다.
vi.mock("@/lib/culture-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/culture-events")>()),
  findEventsNear: vi.fn(),
}));

import { executeFunction } from "../router";
import { findEventsNear } from "@/lib/culture-events";

const mockFind = vi.mocked(findEventsNear);

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return { locale: "ko", dataLocale: "ko", ...over };
}

function events(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `e-${i}`, title: `행사${i}` }));
}

describe("get_nearby_events (채팅 도구)", () => {
  beforeEach(() => {
    mockFind.mockReset();
    mockFind.mockResolvedValue({ events: events(20), total: 84 } as never);
  });

  it("현재 위치 좌표로 조회하고, LLM에는 절단 전 count와 상위 8건만 준다", async () => {
    const r = await executeFunction("get_nearby_events", {}, ctx({ userLocation: SEOUL }));
    expect(mockFind).toHaveBeenCalledWith(SEOUL.lat, SEOUL.lng);
    const data = r.data as { count: number; events: unknown[] };
    expect(data.count).toBe(84);
    expect(data.events).toHaveLength(8);
  });

  it("장소 앵커가 있으면 장소 좌표 기준 (앵커 불변식)", async () => {
    const anchor = { lat: 37.58, lng: 126.97, name: "경복궁" };
    await executeFunction(
      "get_nearby_events",
      {},
      ctx({ userLocation: SEOUL, placeAnchor: anchor }),
    );
    expect(mockFind).toHaveBeenCalledWith(anchor.lat, anchor.lng);
  });

  it("카드를 마운트하지 않는다 — 산문이 정본(목록 두 벌 금지)", async () => {
    const r = await executeFunction("get_nearby_events", {}, ctx({ userLocation: SEOUL }));
    expect(r.render).toBeUndefined();
  });

  it("출처는 서울 열린데이터", async () => {
    const r = await executeFunction("get_nearby_events", {}, ctx({ userLocation: SEOUL }));
    expect(r.source?.[0]?.label).toBe("source.seoulopen");
  });

  it("좌표를 모르면 upstream을 부르지 않는다", async () => {
    const r = await executeFunction("get_nearby_events", {}, ctx());
    expect(mockFind).not.toHaveBeenCalled();
    expect((r.data as { error?: string }).error).toBeTruthy();
  });

  it("국외 앵커는 커버리지 안내만 — provider 미호출(쿼터 보호)", async () => {
    const r = await executeFunction("get_nearby_events", {}, ctx({ userLocation: TOKYO }));
    expect(mockFind).not.toHaveBeenCalled();
    expect((r.data as { outOfCoverage?: boolean }).outOfCoverage).toBe(true);
  });

  it("서울 밖 국내 좌표는 '정보 미보유' — provider 미호출, 0건으로 위장하지 않는다", async () => {
    // count:0을 넘기면 LLM이 "부산엔 오늘 행사가 없습니다"로 요약해 데이터
    // 한계가 지역의 부재로 둔갑한다. 오류도 아니므로 error 필드는 없다.
    const r = await executeFunction(
      "get_nearby_events",
      {},
      ctx({ userLocation: { lat: 35.1796, lng: 129.0756 } }), // 부산
    );
    expect(mockFind).not.toHaveBeenCalled();
    const data = r.data as { unavailableHere?: string; notice?: string; error?: string };
    expect(data.unavailableHere).toBe("seoulOnly");
    expect(data.notice).toBeTruthy();
    expect(data.error).toBeUndefined();
  });

  it("서울 인접 시(하남 미사)는 서비스권 — 조회한다", async () => {
    mockFind.mockResolvedValue({ events: [], total: 0 } as never);
    const r = await executeFunction("get_nearby_events", {}, ctx({ userLocation: { lat: 37.562, lng: 127.193 } }));
    expect(mockFind).toHaveBeenCalled();
    expect((r.data as { count: number }).count).toBe(0);
  });
});

/**
 * 따릉이도 서울 전용이라 같은 게이트를 받는다. 도구별 테스트 파일이 따로 없어
 * 여기 둔다(같은 계약을 검증하므로 흩어 두면 한쪽만 낡는다).
 */
describe("get_bike_stations (서울 전용 게이트)", () => {
  it("지방 좌표는 '정보 미보유' — provider 미호출", async () => {
    const r = await executeFunction(
      "get_bike_stations",
      {},
      ctx({ userLocation: { lat: 35.1796, lng: 129.0756 } }), // 부산
    );
    expect((r.data as { unavailableHere?: string }).unavailableHere).toBe("seoulOnly");
    expect(r.render).toBeUndefined(); // 미제공 지역에 카드를 띄우지 않는다
  });

  it("서울 안은 정상 조회", async () => {
    const r = await executeFunction("get_bike_stations", {}, ctx({ userLocation: SEOUL }));
    expect((r.data as { unavailableHere?: string }).unavailableHere).toBeUndefined();
  });
});

/**
 * 지하철은 서울 전용이 아니라 "연속량" 축이다 — 판정 대신 최근접 역을 넘겨
 * LLM이 거리로 답하게 한다(웹·iOS·CLI와 같은 계약).
 */
describe("get_subway_arrivals (0건 → 최근접 역)", () => {
  it("도시철도 없는 지역은 nearest를 함께 넘긴다", async () => {
    const r = await executeFunction(
      "get_subway_arrivals",
      {},
      ctx({ userLocation: { lat: 37.764, lng: 128.8996 } }), // 강릉
    );
    const data = r.data as { count: number; nearest?: { distanceMeters: number } };
    expect(data.count).toBe(0);
    expect(data.nearest?.distanceMeters).toBeGreaterThan(50_000);
  });
});
