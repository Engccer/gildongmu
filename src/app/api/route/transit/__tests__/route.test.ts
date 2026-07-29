import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasOdsayKey: vi.fn(() => true),
}));
vi.mock("@/lib/providers/odsay", () => ({
  getTransitRoute: vi.fn(async () => ({
    totalTime: 30,
    totalWalk: 200,
    payment: 1500,
    legs: [],
  })),
}));

import { GET } from "../route";
import { hasOdsayKey } from "@/lib/env";
import { getTransitRoute } from "@/lib/providers/odsay";

function makeRequest(origin: string, dest: string) {
  const params = new URLSearchParams({ origin, dest });
  return new NextRequest(`http://x/api/route/transit?${params.toString()}`);
}

describe("GET /api/route/transit", () => {
  beforeEach(() => {
    vi.mocked(hasOdsayKey).mockReturnValue(true);
  });

  it("origin 형식 오류 → 400", async () => {
    const res = await GET(makeRequest("not-a-coord", "37.6,127.1"));
    expect(res.status).toBe(400);
  });

  it("출발지가 한국 밖이면 200 outOfCoverage(provider 미호출)", async () => {
    const res = await GET(makeRequest("37.7749,-122.4194", "37.5665,126.978"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(getTransitRoute).not.toHaveBeenCalled();
  });

  it("목적지가 한국 밖이면 200 outOfCoverage(provider 미호출)", async () => {
    const res = await GET(makeRequest("37.5665,126.978", "37.7749,-122.4194"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(getTransitRoute).not.toHaveBeenCalled();
  });

  it("전지구 범위 밖 좌표는 여전히 400(형식 오류와 커버리지 마커는 별개)", async () => {
    const res = await GET(makeRequest("95,200", "37.6,127.1"));
    expect(res.status).toBe(400);
  });

  it("키 없음(hasOdsayKey false)은 503", async () => {
    vi.mocked(hasOdsayKey).mockReturnValue(false);
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(503);
  });

  it("정상 경로 → {result} shape", async () => {
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toEqual({
      totalTime: 30,
      totalWalk: 200,
      payment: 1500,
      legs: [],
    });
  });

  it("경로 없음(provider null) → 200 {result: null}", async () => {
    vi.mocked(getTransitRoute).mockResolvedValueOnce(null);
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBeNull();
  });

  it("provider throw → 502", async () => {
    vi.mocked(getTransitRoute).mockRejectedValueOnce(new Error("fail"));
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(502);
  });
});
