import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  checkWalkInfraRateLimit: vi.fn(() => true),
  clientIpFromHeaders: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/walk-infra", () => ({
  getWalkInfrastructure: vi.fn(),
}));

import { GET } from "../route";
import { checkWalkInfraRateLimit } from "@/lib/rate-limit";
import { getWalkInfrastructure } from "@/lib/walk-infra";
import type { WalkInfrastructure } from "@/lib/walk-infra";

const mockGetWalk = vi.mocked(getWalkInfrastructure);
const mockRateLimit = vi.mocked(checkWalkInfraRateLimit);

const OK_RESULT: WalkInfrastructure = {
  audioSignals: {
    status: "ok",
    data: { deviceCount: 3, sites: [{ distanceMeters: 45, bearing: "se", deviceCount: 2 }], baseDate: "2026-05-28" },
  },
  osm: {
    status: "ok",
    data: { features: [], totalCount: 0, listedCount: 0, truncated: false, crossingTotal: 0, tactileTotal: 0 },
  },
};

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/walk/nearby${query}`);
}

describe("GET /api/walk/nearby", () => {
  beforeEach(() => {
    mockRateLimit.mockReset();
    mockRateLimit.mockReturnValue(true);
    mockGetWalk.mockReset();
    mockGetWalk.mockResolvedValue(OK_RESULT);
  });

  it("정상 → 200 {walk} shape", async () => {
    const res = await GET(makeRequest("?lat=37.5&lng=127.0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.walk).toEqual(OK_RESULT);
  });

  it("lat 누락 → 400", async () => {
    const res = await GET(makeRequest("?lng=127.0"));
    expect(res.status).toBe(400);
    expect(mockGetWalk).not.toHaveBeenCalled();
  });

  it("両 소스 error → 503", async () => {
    mockGetWalk.mockResolvedValue({
      audioSignals: { status: "error" },
      osm: { status: "error" },
    });
    const res = await GET(makeRequest("?lat=37.5&lng=127.0"));
    expect(res.status).toBe(503);
  });

  it("부분 실패(osm만 error)는 200 - 부분 결과 보존", async () => {
    mockGetWalk.mockResolvedValue({
      audioSignals: OK_RESULT.audioSignals,
      osm: { status: "error" },
    });
    const res = await GET(makeRequest("?lat=37.5&lng=127.0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.walk.osm).toEqual({ status: "error" });
    expect(body.walk.audioSignals).toEqual(OK_RESULT.audioSignals);
  });

  it("한국 밖 좌표 → 200 + osm unsupported(outsideKorea), 오류도 0건도 아니다", async () => {
    // seed 범위 밖은 조회 실패(503)가 아니라 "그 지역은 자료가 없다"는 정직한 상태다.
    // 음향신호기도 서울 밖이라 unsupported이지만, 둘 다 error가 아니므로 200이 맞다.
    mockGetWalk.mockResolvedValue({
      audioSignals: { status: "unsupported", reason: "outsideSeoul" },
      osm: { status: "unsupported", reason: "outsideKorea" },
    });
    const res = await GET(makeRequest("?lat=35.68&lng=139.77"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.walk.osm).toEqual({ status: "unsupported", reason: "outsideKorea" });
    expect(body.walk.audioSignals).toEqual({ status: "unsupported", reason: "outsideSeoul" });
  });

  it("레이트리밋 초과 → 429", async () => {
    mockRateLimit.mockReturnValue(false);
    const res = await GET(makeRequest("?lat=37.5&lng=127.0"));
    expect(res.status).toBe(429);
    expect(mockGetWalk).not.toHaveBeenCalled();
  });
});

/**
 * 이 라우트는 커버리지 마커가 없다(OSM은 전 지구) — 그래서 빈 문자열이
 * (0,0)으로 coerce되면 "서비스 지역 밖"이 아니라 **널 아일랜드로 실제 조회**가
 * 나간다. 누락(`?? undefined`)은 이미 막혀 있었고 빈 문자열만 남아 있었다(백로그 D3).
 */
describe("좌표 파라미터 누락 (D3)", () => {
  beforeEach(() => {
    mockGetWalk.mockReset();
    mockRateLimit.mockReturnValue(true);
  });

  it("lat·lng 없음 → 400, upstream 미호출", async () => {
    expect((await GET(makeRequest(""))).status).toBe(400);
    expect(mockGetWalk).not.toHaveBeenCalled();
  });

  it("빈 문자열 좌표 → 400, upstream 미호출 (널 아일랜드 조회 금지)", async () => {
    expect((await GET(makeRequest("?lat=&lng="))).status).toBe(400);
    expect(mockGetWalk).not.toHaveBeenCalled();
  });
});
