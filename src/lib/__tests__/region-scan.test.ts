import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  destinationPoint,
  regionSamplePoints,
  sidoOf,
  scanSidos,
} from "@/lib/region-scan";
import { haversineMeters } from "@/lib/geo";

vi.mock("@/lib/providers/kakao-address", () => ({
  coordToRegion: vi.fn(),
}));
const { coordToRegion } = await import("@/lib/providers/kakao-address");
const mockRegion = vi.mocked(coordToRegion);

const 강동구청 = { lat: 37.5301, lng: 127.1238 };

describe("destinationPoint", () => {
  it("요청한 거리만큼 떨어진 좌표를 준다", () => {
    const moved = destinationPoint(강동구청, 0, 3000);
    // 왕복 Haversine으로 검증 — 구면 이동이라 오차 1m 이내
    expect(
      haversineMeters(강동구청.lat, 강동구청.lng, moved.lat, moved.lng),
    ).toBeCloseTo(3000, 0);
  });

  it("방위 0은 북쪽(위도 증가), 90은 동쪽(경도 증가)", () => {
    expect(destinationPoint(강동구청, 0, 3000).lat).toBeGreaterThan(강동구청.lat);
    expect(destinationPoint(강동구청, 90, 3000).lng).toBeGreaterThan(강동구청.lng);
  });
});

describe("regionSamplePoints", () => {
  it("중심 + 8방위 = 9점이고 중심이 첫 원소", () => {
    const points = regionSamplePoints(강동구청, 3000);
    expect(points).toHaveLength(9);
    expect(points[0]).toEqual(강동구청);
  });

  // 반경 0/음수는 "반경 없음"이지 오류가 아니다 — 중심 한 점으로 축약한다.
  it("반경이 0 이하면 중심 한 점만", () => {
    expect(regionSamplePoints(강동구청, 0)).toEqual([강동구청]);
    expect(regionSamplePoints(강동구청, -1)).toEqual([강동구청]);
  });
});

describe("sidoOf", () => {
  it("첫 공백 앞 토큰이 시도", () => {
    expect(sidoOf("서울특별시 강동구 길동")).toBe("서울특별시");
    expect(sidoOf("경기도 하남시 감일동")).toBe("경기도");
  });

  // 없는 값을 지어내지 않는다 — 호출부가 3-state로 다룬다.
  it("빈 값·null은 null", () => {
    expect(sidoOf(null)).toBeNull();
    expect(sidoOf("")).toBeNull();
    expect(sidoOf("   ")).toBeNull();
  });
});

describe("scanSidos", () => {
  // ⚠ 중괄호 필수 — `beforeEach(() => mock.mockClear())`는 mockClear가 돌려주는
  // **mock 함수 자체**를 반환하고, vitest는 훅이 반환한 함수를 teardown 콜백으로
  // 등록해 테스트 후 **인자 없이** 호출한다. 그러면 mock 구현이 undefined를 받아
  // 터지거나(TypeError) allSettled 밖에서 reject해 테스트가 엉뚱하게 실패한다.
  beforeEach(() => {
    mockRegion.mockClear();
  });

  it("중복을 제거하고 중심 시도를 첫 원소로 둔다", async () => {
    mockRegion.mockResolvedValue("서울특별시 강동구 길동");
    await expect(scanSidos(강동구청, 3000)).resolves.toEqual(["서울특별시"]);
    expect(mockRegion).toHaveBeenCalledTimes(9);
  });

  // 시도 경계는 실재한다 — 강동구청 3.6km에 경기도 하남시 기관이 있다.
  it("반경이 시도 경계를 넘으면 합집합을 준다", async () => {
    mockRegion.mockImplementation(async (coord) =>
      coord.lng > 127.13 ? "경기도 하남시 감일동" : "서울특별시 강동구 길동",
    );
    const sidos = await scanSidos(강동구청, 3000);
    expect(sidos).toEqual(["서울특별시", "경기도"]);
  });

  // 바다·국경 밖 샘플이 실패해도 나머지는 살린다(부분 성공 보존).
  it("일부 샘플이 실패해도 성공분으로 답한다", async () => {
    let call = 0;
    mockRegion.mockImplementation(async () => {
      call += 1;
      if (call % 2 === 0) throw new Error("좌표→행정동 변환 실패");
      return "서울특별시 강동구 길동";
    });
    await expect(scanSidos(강동구청, 3000)).resolves.toEqual(["서울특별시"]);
  });

  // 전멸은 빈 배열 — "조회 실패"를 임의의 시도로 위장하지 않는다.
  it("전부 실패하면 빈 배열", async () => {
    mockRegion.mockRejectedValue(new Error("HTTP 500"));
    await expect(scanSidos(강동구청, 3000)).resolves.toEqual([]);
  });
});
