import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({ hasKakaoKey: vi.fn(() => true) }));
vi.mock("@/lib/providers/kakao-address", () => ({
  coordToAddress: vi.fn(async () => ({
    roadAddress: "서울 강동구 천호대로 1077",
    display: "서울 강동구 천호대로 1077",
  })),
}));

import { GET } from "../route";
import { hasKakaoKey } from "@/lib/env";
import { coordToAddress } from "@/lib/providers/kakao-address";

function makeRequest(lat: string, lng: string) {
  return new NextRequest(`http://x/api/geocode/reverse?lat=${lat}&lng=${lng}`);
}

describe("GET /api/geocode/reverse", () => {
  beforeEach(() => {
    vi.mocked(hasKakaoKey).mockReturnValue(true);
    vi.mocked(coordToAddress).mockResolvedValue({
      roadAddress: "서울 강동구 천호대로 1077",
      display: "서울 강동구 천호대로 1077",
    });
  });

  it("좌표 형식 오류 → 400", async () => {
    const res = await GET(makeRequest("not-a-lat", "127.14"));
    expect(res.status).toBe(400);
  });

  it("키 없으면 → 503", async () => {
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    const res = await GET(makeRequest("37.53", "127.14"));
    expect(res.status).toBe(503);
  });

  it("정상 경로 → { address } 문자열", async () => {
    const res = await GET(makeRequest("37.53", "127.14"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: "서울 강동구 천호대로 1077",
    });
  });

  it("매칭 없음 → address null (3-state: 실패 아님)", async () => {
    vi.mocked(coordToAddress).mockResolvedValue(null);
    const res = await GET(makeRequest("37.53", "127.14"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: null });
  });

  it("upstream 실패 → 502", async () => {
    vi.mocked(coordToAddress).mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest("37.53", "127.14"));
    expect(res.status).toBe(502);
  });
});
