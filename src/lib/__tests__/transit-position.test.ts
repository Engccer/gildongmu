import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../providers/seoul-subway-position", () => ({
  fetchSubwayLinePositions: vi.fn(),
}));

import { trackSubwayPosition } from "../transit-position";
import { fetchSubwayLinePositions } from "../providers/seoul-subway-position";

const fetchMock = vi.mocked(fetchSubwayLinePositions);
// 2026-09-23 14:50:00 KST
const NOW = Date.parse("2026-09-23T14:50:00+09:00");

describe("trackSubwayPosition — 3-state 응답(E35 §3.2)", () => {
  beforeEach(() => fetchMock.mockReset());

  it("ODsay 노선명을 서울 표기로 매핑해 조회하고, 잠근 열차를 찾으면 found + 데이터 나이", async () => {
    fetchMock.mockResolvedValue({
      trains: [
        { trainNo: "5128", station: "길동", trainStatus: "3", receivedAt: "2026-09-23 14:49:20" },
        { trainNo: "5606", station: "개롱", trainStatus: "2", receivedAt: "2026-09-23 14:49:24" },
      ],
      total: 2,
      truncated: false,
    });
    const r = await trackSubwayPosition({ lineName: "수도권 5호선", trainNo: "5128", now: NOW });
    expect(fetchMock).toHaveBeenCalledWith("5호선", NOW);
    expect(r).toEqual({
      status: "found", station: "길동", trainStatus: "3",
      dataStamp: "2026-09-23 14:49:20", dataAgeSeconds: 40,
    });
  });

  it("미래 수신 시각은 0으로 클램프, 결측·파싱 불가는 null", async () => {
    fetchMock.mockResolvedValue({
      trains: [
        { trainNo: "1", station: "A", receivedAt: "2026-09-23 14:51:00" },
        { trainNo: "2", station: "B" },
        { trainNo: "3", station: "C", receivedAt: "어제" },
      ],
      total: 3, truncated: false,
    });
    const age = async (trainNo: string) => {
      const r = await trackSubwayPosition({ lineName: "수도권 5호선", trainNo, now: NOW });
      return r.status === "found" ? r.dataAgeSeconds : "x";
    };
    expect(await age("1")).toBe(0);
    expect(await age("2")).toBeNull();
    expect(await age("3")).toBeNull();
  });

  it("목록에 없는 열차는 notFound(정보 없음) — total을 싣는다", async () => {
    fetchMock.mockResolvedValue({ trains: [], total: 0, truncated: false });
    expect(await trackSubwayPosition({ lineName: "수도권 2호선", trainNo: "2269", now: NOW }))
      .toEqual({ status: "notFound", total: 0 });
  });

  it("매핑 밖 노선은 upstream 없이 unsupported", async () => {
    expect(await trackSubwayPosition({ lineName: "부산 1호선", trainNo: "1", now: NOW }))
      .toEqual({ status: "unsupported" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("키 없음(provider null)은 unsupported", async () => {
    fetchMock.mockResolvedValue(null);
    expect(await trackSubwayPosition({ lineName: "수도권 5호선", trainNo: "5128", now: NOW }))
      .toEqual({ status: "unsupported" });
  });

  it("upstream 실패는 throw(라우트 502) — notFound로 접지 않는다", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    await expect(trackSubwayPosition({ lineName: "수도권 5호선", trainNo: "5128", now: NOW }))
      .rejects.toThrow("boom");
  });
});
