import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasDataGoKrKey: vi.fn(() => true),
  hasKakaoKey: vi.fn(() => true),
}));
// 역지오코딩만 모킹하고 **판정(`isUncoveredBusRegion`)은 실제 구현**을 쓴다(bike 라우트
// 선례). 판정까지 모킹하면 라우트가 진짜 seed를 보는지 검증하지 못해 동명 시군 회귀가
// 통과한다. `fetchNearbyBusStops`만 모킹하고 나머지 bus.ts는 원본을 남긴다.
vi.mock("@/lib/bus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bus")>()),
  fetchNearbyBusStops: vi.fn(),
}));
vi.mock("@/lib/providers/kakao-address", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/kakao-address")>()),
  coordToRegionNames: vi.fn(),
}));

import { GET } from "../route";
import { hasDataGoKrKey, hasKakaoKey } from "@/lib/env";
import { fetchNearbyBusStops } from "@/lib/bus";
import { coordToRegionNames } from "@/lib/providers/kakao-address";

const mockHasKey = vi.mocked(hasDataGoKrKey);
const mockHasKakao = vi.mocked(hasKakaoKey);
const mockFetch = vi.mocked(fetchNearbyBusStops);
const mockRegion = vi.mocked(coordToRegionNames);

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/bus/nearby${query}`);
}

describe("GET /api/bus/nearby (커버리지 마커 계약)", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockHasKakao.mockReset();
    mockHasKakao.mockReturnValue(true);
    mockFetch.mockReset();
    mockRegion.mockReset();
  });

  it("한국 밖 좌표는 200 outOfCoverage 마커(upstream 미호출)", async () => {
    const res = await GET(makeRequest("?lat=37.7749&lng=-122.4194"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("전지구 범위 밖 좌표는 여전히 400", async () => {
    const res = await GET(makeRequest("?lat=95&lng=200"));
    expect(res.status).toBe(400);
  });
});

/**
 * 좌표 파라미터 누락은 400이다 — `Number("") === 0`으로 (0,0)이 되면
 * `isInKorea`가 false라 **400이어야 할 요청이 200 outOfCoverage로 위장**된다
 * (백로그 D3, 정본 헬퍼 `@/lib/coord-param`).
 */
describe("좌표 파라미터 누락 (D3)", () => {
  it("lat·lng 없음 → 400 (outOfCoverage 위장 금지)", async () => {
    expect((await GET(makeRequest(""))).status).toBe(400);
  });

  it("빈 문자열 좌표 → 400", async () => {
    expect((await GET(makeRequest("?lat=&lng="))).status).toBe(400);
  });
});

/**
 * TAGO 미커버 지역 마커(스펙 `2026-08-02-bus-uncovered-region-design.md`).
 *
 * 좌표는 실측 지점을 쓰고 지역 이름은 카카오 `coord2regioncode`의 실제 출력을 쓴다.
 */
describe("미커버 지역 마커 (A2)", () => {
  const 강릉 = "?lat=37.7547&lng=128.8789"; // 강릉 시외버스터미널
  const 해남 = "?lat=34.5739&lng=126.5996"; // 해남군청
  const 길동 = "?lat=37.5385&lng=127.1435";

  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockHasKakao.mockReset();
    mockHasKakao.mockReturnValue(true);
    mockFetch.mockReset();
    mockRegion.mockReset();
  });

  it("0건 + TAGO 미보유 시군 → unavailableHere 마커", async () => {
    mockFetch.mockResolvedValue([]);
    mockRegion.mockResolvedValue({ province: "강원특별자치도", city: "강릉시" });
    const res = await GET(makeRequest(강릉));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stops: [], unavailableHere: "noBusData" });
  });

  it("0건이어도 TAGO 보유 시군이면 마커 없음: 0건 대부분은 700m 반경 밖이다", async () => {
    // 해남엔 정류소가 1,328개 등록돼 있고 군청 최근접이 806m라 0건이 나온다.
    mockFetch.mockResolvedValue([]);
    mockRegion.mockResolvedValue({ province: "전라남도", city: "해남군" });
    expect(await (await GET(makeRequest(해남))).json()).toEqual({ stops: [] });
  });

  it("결과가 있으면 역지오코딩을 아예 호출하지 않는다: 담양 회귀 가드", async () => {
    // 담양은 TAGO 도시코드가 없지만 광주 버스가 넘어와 정류소가 잡힌다. 사전 판정하면
    // 거짓 "미제공"이 나가므로, 판정은 0건일 때만 발동해야 한다.
    mockFetch.mockResolvedValue([{ name: "담양군청" }] as never);
    const body = await (await GET(makeRequest("?lat=35.3212&lng=126.9882"))).json();
    expect(body).toEqual({ stops: [{ name: "담양군청" }] });
    expect(mockRegion).not.toHaveBeenCalled();
  });

  it("판정 불가는 마커를 달지 않는다(fail-open): 카카오 키 없음", async () => {
    mockFetch.mockResolvedValue([]);
    mockHasKakao.mockReturnValue(false);
    expect(await (await GET(makeRequest(강릉))).json()).toEqual({ stops: [] });
    expect(mockRegion).not.toHaveBeenCalled();
  });

  it("판정 불가는 마커를 달지 않는다(fail-open): 역지오코딩 실패·모르는 시도", async () => {
    mockFetch.mockResolvedValue([]);
    mockRegion.mockRejectedValueOnce(new Error("카카오 장애"));
    expect(await (await GET(makeRequest(강릉))).json()).toEqual({ stops: [] });

    mockRegion.mockResolvedValueOnce(null);
    expect(await (await GET(makeRequest(강릉))).json()).toEqual({ stops: [] });

    // 행정구역 개편으로 매핑이 낡으면 unknown이고, 그때도 미제공으로 단정하지 않는다.
    mockRegion.mockResolvedValueOnce({ province: "가상통합특별시", city: "어딘가시" });
    expect(await (await GET(makeRequest(강릉))).json()).toEqual({ stops: [] });
  });

  it("서울은 TOPIS 커버라 0건이어도 마커가 없다", async () => {
    mockFetch.mockResolvedValue([]);
    mockRegion.mockResolvedValue({ province: "서울특별시", city: "강동구" });
    expect(await (await GET(makeRequest(길동))).json()).toEqual({ stops: [] });
  });
});
