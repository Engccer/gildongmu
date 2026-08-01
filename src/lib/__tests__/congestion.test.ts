import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../providers/seoul-congestion", () => ({ loadCongestion: vi.fn() }));

import { findCongestionNear } from "../congestion";
import { loadCongestion } from "../providers/seoul-congestion";

const mockLoad = vi.mocked(loadCongestion);

const READING = {
  level: "붐빔",
  message: "사람들이 몰려있을 가능성이 매우 크고…",
  asOf: "2026-08-01 13:40",
  forecast: [{ time: "2026-08-01 15:00", level: "약간 붐빔" }],
};

describe("findCongestionNear", () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockLoad.mockResolvedValue(READING);
  });

  it("영역 안이면 그 영역 코드로 조회하고 이름을 붙여 돌려준다", async () => {
    const { area } = await findCongestionNear(37.4979, 127.0276); // 강남역 11번 출구
    expect(mockLoad).toHaveBeenCalledWith("POI014");
    expect(area?.name).toBe("강남역");
    expect(area?.level).toBe("붐빔");
  });

  it("영역 밖이면 upstream을 부르지 않는다(서울의 91% — 쿼터 보호)", async () => {
    const { area } = await findCongestionNear(37.538, 127.142); // 길동
    expect(area).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("영역은 있으나 데이터가 없으면 null(등급 없음과 조회 실패를 뭉개지 않는다)", async () => {
    mockLoad.mockResolvedValue(null);
    const { area } = await findCongestionNear(37.4979, 127.0276);
    expect(area).toBeNull();
  });

  it("provider가 던지면 그대로 올린다(라우트가 502로 가른다)", async () => {
    mockLoad.mockRejectedValue(new Error("citydata_ppltn ERROR-500"));
    await expect(findCongestionNear(37.4979, 127.0276)).rejects.toThrow(/ERROR-500/);
  });

  it("예보는 서비스 반환값에 남는다(채팅이 소비 — 라우트만 벗겨 낸다)", async () => {
    const { area } = await findCongestionNear(37.4979, 127.0276);
    expect(area?.forecast).toHaveLength(1);
  });
});
