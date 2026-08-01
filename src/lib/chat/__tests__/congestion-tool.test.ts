import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

const SEOUL = { lat: 37.5665, lng: 126.978 };
const TOKYO = { lat: 35.6762, lng: 139.6503 };

vi.mock("@/lib/congestion", () => ({ findCongestionNear: vi.fn() }));

import { executeFunction } from "../router";
import { findCongestionNear } from "@/lib/congestion";

const mockFind = vi.mocked(findCongestionNear);

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return { locale: "ko", dataLocale: "ko", ...over };
}

const READING = {
  code: "POI014",
  name: "강남역",
  level: "붐빔",
  message: "사람이 많아 이동이 불편합니다.",
  asOf: "2026-08-01 13:40",
  forecast: [
    { time: "2026-08-01 14:00", level: "약간 붐빔" },
    { time: "2026-08-01 15:00", level: "보통" },
  ],
};

describe("get_congestion (채팅 도구)", () => {
  beforeEach(() => {
    mockFind.mockReset();
    mockFind.mockResolvedValue({ area: READING });
  });

  it("현재 위치 좌표로 조회하고 영역 정보를 그대로 넘긴다", async () => {
    const r = await executeFunction("get_congestion", {}, ctx({ userLocation: SEOUL }));
    expect(mockFind).toHaveBeenCalledWith(SEOUL.lat, SEOUL.lng);
    expect((r.data as { area: typeof READING }).area).toEqual(READING);
  });

  it("장소 앵커가 있으면 장소 좌표 기준 (앵커 불변식)", async () => {
    const anchor = { lat: 37.4988, lng: 127.0276, name: "강남역" };
    await executeFunction(
      "get_congestion",
      {},
      ctx({ userLocation: SEOUL, placeAnchor: anchor }),
    );
    expect(mockFind).toHaveBeenCalledWith(anchor.lat, anchor.lng);
  });

  it("예보를 data에 포함한다 — 라우트는 빼지만 채팅은 '두 시간 뒤'에 답해야 한다", async () => {
    const r = await executeFunction("get_congestion", {}, ctx({ userLocation: SEOUL }));
    const area = (r.data as { area: { forecast: unknown[] } }).area;
    expect(area.forecast).toEqual(READING.forecast);
  });

  it("카드를 마운트하지 않는다 — 산문이 정본", async () => {
    const r = await executeFunction("get_congestion", {}, ctx({ userLocation: SEOUL }));
    expect(r.render).toBeUndefined();
  });

  it("출처는 서울 열린데이터", async () => {
    const r = await executeFunction("get_congestion", {}, ctx({ userLocation: SEOUL }));
    expect(r.source).toEqual([{ label: "source.seoulopen" }]);
  });

  it("좌표를 모르면 upstream을 부르지 않는다", async () => {
    const r = await executeFunction("get_congestion", {}, ctx());
    expect(mockFind).not.toHaveBeenCalled();
    expect((r.data as { error?: string }).error).toBeTruthy();
  });

  it("국외 앵커는 커버리지 안내만 — provider 미호출(쿼터 보호)", async () => {
    const r = await executeFunction("get_congestion", {}, ctx({ userLocation: TOKYO }));
    expect(mockFind).not.toHaveBeenCalled();
    expect((r.data as { outOfCoverage?: boolean }).outOfCoverage).toBe(true);
  });

  it("측정 영역 밖은 area:null을 그대로 넘긴다 — 오류로 위장하지 않는다", async () => {
    mockFind.mockResolvedValue({ area: null });
    const r = await executeFunction(
      "get_congestion",
      {},
      ctx({ userLocation: { lat: 37.5385, lng: 127.1395 } }), // 길동 주택가
    );
    const data = r.data as { area: unknown; error?: string; outOfCoverage?: boolean };
    expect(data.area).toBeNull();
    expect(data.error).toBeUndefined();
    expect(data.outOfCoverage).toBeUndefined();
  });
});
