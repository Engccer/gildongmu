import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

const SEOUL = { lat: 37.5665, lng: 126.978 };
const TOKYO = { lat: 35.6762, lng: 139.6503 };

vi.mock("@/lib/culture-events", () => ({ findEventsNear: vi.fn() }));

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

  it("서울 밖 국내 좌표에서 0건은 정직한 답 — 오류로 바꾸지 않는다", async () => {
    mockFind.mockResolvedValue({ events: [], total: 0 } as never);
    const r = await executeFunction(
      "get_nearby_events",
      {},
      ctx({ userLocation: { lat: 35.1796, lng: 129.0756 } }), // 부산
    );
    const data = r.data as { count: number; events: unknown[]; error?: string };
    expect(data.error).toBeUndefined();
    expect(data.count).toBe(0);
    expect(data.events).toEqual([]);
  });
});
