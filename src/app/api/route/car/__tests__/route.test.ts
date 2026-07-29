import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  // hasKakaoKey는 이 라우트가 더 이상 직접 참조하지 않지만, env 모듈 전체를
  // 모킹하므로 다른 공유 import가 undefined 호출 오류를 내지 않도록 유지한다.
  hasKakaoKey: vi.fn(() => true),
  hasCarRouteKey: vi.fn(() => true),
  hasNcpMapsKeys: vi.fn(() => false),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkCarRateLimit: vi.fn(() => true),
  clientIpFromHeaders: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/car-route", () => ({
  getCarRoute: vi.fn(async () => ({
    distanceMeters: 1000,
    durationSeconds: 300,
    steps: [{ description: "직진 후 우회전" }],
  })),
}));
vi.mock("@/lib/providers/ncp-directions", () => ({
  getCarRouteBriefingEn: vi.fn(async () => ({
    distanceMeters: 1000,
    durationSeconds: 300,
    steps: [{ description: "Turn right" }],
  })),
}));

import { GET } from "../route";
import { hasCarRouteKey, hasNcpMapsKeys } from "@/lib/env";
import { checkCarRateLimit } from "@/lib/rate-limit";
import { getCarRoute } from "@/lib/car-route";

function makeRequest(origin: string, dest: string, lang?: string) {
  const params = new URLSearchParams({ origin, dest });
  if (lang !== undefined) params.set("lang", lang);
  return new NextRequest(`http://x/api/route/car?${params.toString()}`);
}

describe("GET /api/route/car", () => {
  beforeEach(() => {
    vi.mocked(hasCarRouteKey).mockReturnValue(true);
    vi.mocked(hasNcpMapsKeys).mockReturnValue(false);
    vi.mocked(checkCarRateLimit).mockReturnValue(true);
    vi.mocked(getCarRoute).mockClear();
  });

  it("origin 형식 오류 → 400", async () => {
    const res = await GET(makeRequest("not-a-coord", "37.6,127.1"));
    expect(res.status).toBe(400);
  });

  it("출발지가 한국 밖이면 200 outOfCoverage(provider 미호출)", async () => {
    const res = await GET(makeRequest("37.7749,-122.4194", "37.5665,126.978"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(getCarRoute).not.toHaveBeenCalled();
  });

  it("목적지가 한국 밖이면 200 outOfCoverage(provider 미호출)", async () => {
    const res = await GET(makeRequest("37.5665,126.978", "37.7749,-122.4194"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(getCarRoute).not.toHaveBeenCalled();
  });

  it("전지구 범위 밖 좌표는 여전히 400(형식 오류와 커버리지 마커는 별개)", async () => {
    const res = await GET(makeRequest("95,200", "37.6,127.1"));
    expect(res.status).toBe(400);
  });

  it("정상 경로 → briefing 그대로 반환", async () => {
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      distanceMeters: 1000,
      durationSeconds: 300,
      steps: [{ description: "직진 후 우회전" }],
    });
  });

  it("키 없음(hasCarRouteKey false, lang 미지정)은 503", async () => {
    vi.mocked(hasCarRouteKey).mockReturnValue(false);
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(503);
  });

  it("키 없음 + 한국 밖 좌표는 커버리지 마커가 우선(503 아니라 200 outOfCoverage)", async () => {
    vi.mocked(hasCarRouteKey).mockReturnValue(false);
    const res = await GET(makeRequest("37.7749,-122.4194", "37.5665,126.978"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(getCarRoute).not.toHaveBeenCalled();
  });

  it("provider throw → 502", async () => {
    vi.mocked(getCarRoute).mockRejectedValueOnce(new Error("fail"));
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(502);
  });

  it("레이트리밋 초과 → 429", async () => {
    vi.mocked(checkCarRateLimit).mockReturnValue(false);
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(429);
    expect(getCarRoute).not.toHaveBeenCalled();
  });
});
