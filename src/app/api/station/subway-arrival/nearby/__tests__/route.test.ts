import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasSeoulSubwayRealtimeKey: vi.fn(() => true),
}));
// findNearestStationInfo는 **실제 구현**을 쓴다(seed 조회, 네트워크 0) — 모킹하면
// 0건일 때 실제 seed에서 최근접 역이 나오는지 검증하지 못한다.
vi.mock("@/lib/providers/subway-nearby", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/subway-nearby")>()),
  fetchNearbySubwayArrivals: vi.fn(),
}));

import { GET } from "../route";
import { hasSeoulSubwayRealtimeKey } from "@/lib/env";
import { fetchNearbySubwayArrivals } from "@/lib/providers/subway-nearby";

const mockHasKey = vi.mocked(hasSeoulSubwayRealtimeKey);
const mockFetch = vi.mocked(fetchNearbySubwayArrivals);

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/station/subway-arrival/nearby${query}`);
}

describe("GET /api/station/subway-arrival/nearby (커버리지 마커 계약)", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockFetch.mockReset();
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
 * 0건일 때 최근접 역 동봉 — "반경 1km 안에 없다"와 "이 지역엔 도시철도가 없다"를
 * 사용자가 거리로 구분한다. 서버가 임계값으로 판정하지 않는 이유는 최근접 역
 * 거리가 전국에 연속 분포하기 때문이다(provider 주석 참고).
 */
describe("결과 0건 → 최근접 역 동봉", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockFetch.mockReset();
  });

  it("도시철도 없는 지역(강릉)은 먼 거리로 나온다", async () => {
    mockFetch.mockResolvedValue([]);
    const body = await (await GET(makeRequest("?lat=37.764&lng=128.8996"))).json();
    expect(body.stations).toEqual([]);
    expect(body.nearest.distanceMeters).toBeGreaterThan(50_000);
    expect(body.nearest.stationName).toBeTruthy();
  });

  it("도시철도권 가장자리(서울 강일)는 걸어갈 만한 거리로 나온다", async () => {
    mockFetch.mockResolvedValue([]);
    const body = await (await GET(makeRequest("?lat=37.571&lng=127.176"))).json();
    expect(body.nearest.distanceMeters).toBeLessThan(3_000);
  });

  it("결과가 있으면 nearest를 싣지 않는다(잉여)", async () => {
    mockFetch.mockResolvedValue([
      { stationName: "강동", nameEn: "Gangdong", lines: ["5호선"], distanceMeters: 200,
        arrivalStatus: "ok", arrivals: [] },
    ] as never);
    const body = await (await GET(makeRequest("?lat=37.5385&lng=127.1234"))).json();
    expect(body.stations).toHaveLength(1);
    expect(body.nearest).toBeUndefined();
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

// E27: `lang=en`은 provider에 "en"으로 전달되고, 0건 최근접 역엔 `linesEn`이 붙는다(실 seed). ko는 종전과 같다.
describe("GET /api/station/subway-arrival/nearby — lang(E27)", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockFetch.mockReset();
  });
  it("en은 provider lang 'en', 0건이면 nearest.linesEn(영문 표)이 실린다", async () => {
    mockFetch.mockResolvedValue([]);
    // 강릉 부근(반경 1km 안 역 없음) — 최근접 역이 seed에서 나온다
    const res = await GET(makeRequest("?lat=37.7519&lng=128.8761&lang=en"));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(37.7519, 128.8761, "en");
    const body = await res.json();
    expect(body.stations).toEqual([]);
    expect(body.nearest.lines.length).toBeGreaterThan(0);
    expect(body.nearest.linesEn).toHaveLength(body.nearest.lines.length);
    expect(JSON.stringify(body.nearest.linesEn)).not.toMatch(/[가-힣]/);
  });
  it("미지정은 provider lang 'ko'이고 nearest에 linesEn이 없다", async () => {
    mockFetch.mockResolvedValue([]);
    const res = await GET(makeRequest("?lat=37.7519&lng=128.8761"));
    expect(mockFetch).toHaveBeenCalledWith(37.7519, 128.8761, "ko");
    const body = await res.json();
    expect(body.nearest.linesEn).toBeUndefined();
  });
  it("미지 lang은 400", async () => {
    expect((await GET(makeRequest("?lat=37.5&lng=127.0&lang=jp"))).status).toBe(400);
  });
});
