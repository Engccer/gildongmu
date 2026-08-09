import { beforeEach, describe, expect, it, vi } from "vitest";

const searchJusoAddresses = vi.fn();
const searchAddress = vi.fn();
vi.mock("../providers/juso-address", () => ({
  searchJusoAddresses: (...a: unknown[]) => searchJusoAddresses(...a),
}));
vi.mock("../providers/kakao-address", () => ({
  searchAddress: (...a: unknown[]) => searchAddress(...a),
}));

const { fetchRoadAxis } = await import("../road-axis-service");

const ORIGIN = { lat: 37.5415, lng: 127.1495 };
const mPerDegLng = 111_320 * Math.cos((37.5415 * Math.PI) / 180);

beforeEach(() => {
  searchJusoAddresses.mockReset();
  searchAddress.mockReset();
});

describe("fetchRoadAxis", () => {
  it("juso 건물 목록을 지오코딩해 축을 세운다", async () => {
    searchJusoAddresses.mockResolvedValue(
      [5, 11, 13, 25, 33].map((n) => ({
        roadAddrPart1: `서울특별시 강동구 명일로24길 ${n}`,
      })),
    );
    searchAddress.mockImplementation(async (addr: string) => {
      const n = Number(addr.match(/(\d+)$/)![1]);
      return [
        { addressName: addr, lat: 37.5415, lng: 127.1495 + (n * 8) / mPerDegLng },
      ];
    });
    const axis = await fetchRoadAxis("서울특별시 강동구", "명일로24길", ORIGIN);
    expect(axis).not.toBeNull();
    expect(axis!.metersPerNumber).toBeCloseTo(8, 0);
    expect(axis!.ux).toBeCloseTo(1, 2);
  });

  it("부번 주소는 축 표본에서 뺀다 — 같은 기초번호라 축을 흐린다", async () => {
    searchJusoAddresses.mockResolvedValue([
      { roadAddrPart1: "서울 강동구 명일로 200-16" },
      { roadAddrPart1: "서울 강동구 명일로 200-34" },
      { roadAddrPart1: "서울 강동구 명일로 200-9" },
    ]);
    searchAddress.mockResolvedValue([
      { addressName: "x", lat: 37.5415, lng: 127.1495 },
    ]);
    expect(await fetchRoadAxis("서울 강동구", "명일로", ORIGIN)).toBeNull();
    expect(searchAddress).not.toHaveBeenCalled();
  });

  it("표본이 모자라면 null (거짓 축을 세우지 않는다)", async () => {
    searchJusoAddresses.mockResolvedValue([
      { roadAddrPart1: "서울 강동구 성내로 25" },
    ]);
    expect(await fetchRoadAxis("서울 강동구", "성내로", ORIGIN)).toBeNull();
  });

  it("juso가 throw하면 null로 흡수한다 — 축 실패는 방위 폴백이지 오류가 아니다", async () => {
    searchJusoAddresses.mockRejectedValue(new Error("HTTP 500"));
    expect(await fetchRoadAxis("서울 강동구", "성내로", ORIGIN)).toBeNull();
  });

  it("지오코딩이 일부 실패해도 남은 표본으로 세운다", async () => {
    searchJusoAddresses.mockResolvedValue(
      [1, 3, 5, 7].map((n) => ({ roadAddrPart1: `서울 강동구 성내로 ${n}` })),
    );
    searchAddress.mockImplementation(async (addr: string) => {
      const n = Number(addr.match(/(\d+)$/)![1]);
      if (n === 3) return [];
      return [
        { addressName: addr, lat: 37.5415, lng: 127.1495 + (n * 10) / mPerDegLng },
      ];
    });
    const axis = await fetchRoadAxis("서울 강동구", "성내로", ORIGIN);
    expect(axis?.sampleCount).toBe(3);
  });
});
