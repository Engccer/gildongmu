import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

vi.mock("@/lib/providers/tago-subway", () => ({ fetchStationTimetable: vi.fn() }));

import { executeFunction } from "../router";
import { fetchStationTimetable } from "@/lib/providers/tago-subway";

const mockFetch = vi.mocked(fetchStationTimetable);
const ctx: ExecutionContext = { locale: "ko", dataLocale: "ko" };

const TIMETABLE = {
  stationName: "강동",
  dailyType: "weekday" as const,
  lines: [{ lineName: "5호선", directions: [] }],
};

describe("get_station_timetable (채팅 도구, K3 ①)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(TIMETABLE);
  });

  it("역 이름으로 조회하고 시간표를 그대로 넘긴다 — 카드 없음, 출처 TAGO", async () => {
    const r = await executeFunction("get_station_timetable", { stationName: "강동" }, ctx);
    expect(mockFetch).toHaveBeenCalledWith("강동");
    expect(r.data).toEqual({ timetable: TIMETABLE });
    expect(r.render).toBeUndefined();
    expect(r.source).toEqual([{ label: "source.tago" }]);
  });

  it("미커버 역은 timetable:null을 그대로 싣는다 — 빈 lines와 구분(3-state)", async () => {
    mockFetch.mockResolvedValue(null);
    const r = await executeFunction("get_station_timetable", { stationName: "없는역" }, ctx);
    expect(r.data).toEqual({ timetable: null });
  });

  it("partial 플래그를 보존한다 — 일부 노선 실패를 무운행으로 위장하지 않는다", async () => {
    mockFetch.mockResolvedValue({ ...TIMETABLE, partial: true });
    const r = await executeFunction("get_station_timetable", { stationName: "강동" }, ctx);
    expect((r.data as { timetable: { partial?: true } }).timetable.partial).toBe(true);
  });

  it("역 이름이 비면 upstream을 부르지 않는다", async () => {
    const r = await executeFunction("get_station_timetable", {}, ctx);
    expect(mockFetch).not.toHaveBeenCalled();
    expect((r.data as { error?: string }).error).toBeTruthy();
  });

  it("upstream throw는 흡수하지 않고 전파한다(agent-loop가 error로 전달)", async () => {
    mockFetch.mockRejectedValue(new Error("TAGO 실패"));
    await expect(executeFunction("get_station_timetable", { stationName: "강동" }, ctx)).rejects.toThrow("TAGO 실패");
  });
});
