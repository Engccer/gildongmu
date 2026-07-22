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

  it("레이트리밋 초과 → 429", async () => {
    mockRateLimit.mockReturnValue(false);
    const res = await GET(makeRequest("?lat=37.5&lng=127.0"));
    expect(res.status).toBe(429);
    expect(mockGetWalk).not.toHaveBeenCalled();
  });
});
