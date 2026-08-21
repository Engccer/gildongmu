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

function makeRequest(origin: string, dest: string, includeStops?: string) {
  const params = new URLSearchParams({ origin, dest });
  if (includeStops !== undefined) params.set("includeStops", includeStops);
  return new NextRequest(`http://x/api/route/transit?${params.toString()}`);
}

describe("GET /api/route/transit", () => {
  beforeEach(() => {
    vi.mocked(hasOdsayKey).mockReturnValue(true);
    vi.mocked(getTransitRoute).mockClear();
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

  it("키 없음 + 한국 밖 좌표는 커버리지 마커가 우선(503 아니라 200 outOfCoverage)", async () => {
    vi.mocked(hasOdsayKey).mockReturnValue(false);
    const res = await GET(makeRequest("37.7749,-122.4194", "37.5665,126.978"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(getTransitRoute).not.toHaveBeenCalled();
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

  // includeStops 옵트인(B2 §7, walk includeGeometry 선례)
  it("미지정은 includeStops false로 전달된다(byte-호환 계약)", async () => {
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(200);
    expect(getTransitRoute).toHaveBeenCalledWith(
      expect.objectContaining({ includeStops: false }),
    );
  });

  it("includeStops=1은 옵트인 true로 전달된다", async () => {
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1", "1"));
    expect(res.status).toBe(200);
    expect(getTransitRoute).toHaveBeenCalledWith(
      expect.objectContaining({ includeStops: true }),
    );
  });

  it("includeStops가 1이 아닌 값이면 400(조용한 무시 금지 — walk 동형)", async () => {
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1", "true"));
    expect(res.status).toBe(400);
    expect(getTransitRoute).not.toHaveBeenCalled();
  });

  describe("via 경유지(N4) — ODsay에 경유지 없음", () => {
    it("via가 있으면 upstream 미호출 + 200 {result:null, unsupported:'waypoint'}", async () => {
      const res = await GET(new NextRequest("http://x/api/route/transit?origin=37.5,127.0&dest=37.6,127.1&via=37.55,127.05"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: null, unsupported: "waypoint" });
      expect(getTransitRoute).not.toHaveBeenCalled();
    });

    it("경유지가 한국 밖이면 unsupported보다 outOfCoverage가 먼저다", async () => {
      const res = await GET(new NextRequest("http://x/api/route/transit?origin=37.5,127.0&dest=37.6,127.1&via=37.7749,-122.4194"));
      expect(await res.json()).toEqual({ outOfCoverage: true });
    });

    it("via 형식 오류는 400", async () => {
      const res = await GET(new NextRequest("http://x/api/route/transit?origin=37.5,127.0&dest=37.6,127.1&via=x"));
      expect(res.status).toBe(400);
    });
  });
});
