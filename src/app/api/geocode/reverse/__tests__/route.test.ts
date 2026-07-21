import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasKakaoKey: vi.fn(() => true),
  hasNcpMapsKeys: vi.fn(() => true),
}));
vi.mock("@/lib/providers/kakao-address", () => ({
  coordToAddress: vi.fn(async () => ({
    roadAddress: "서울 강동구 천호대로 1077",
    display: "서울 강동구 천호대로 1077",
  })),
}));
vi.mock("@/lib/providers/ncp-geocode", () => ({
  reverseRoadAddress: vi.fn(async () => null),
}));

import { GET } from "../route";
import { hasKakaoKey, hasNcpMapsKeys } from "@/lib/env";
import { coordToAddress } from "@/lib/providers/kakao-address";
import { reverseRoadAddress } from "@/lib/providers/ncp-geocode";

function makeRequest(lat: string, lng: string) {
  return new NextRequest(`http://x/api/geocode/reverse?lat=${lat}&lng=${lng}`);
}

describe("GET /api/geocode/reverse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasKakaoKey).mockReturnValue(true);
    vi.mocked(hasNcpMapsKeys).mockReturnValue(true);
    vi.mocked(coordToAddress).mockResolvedValue({
      roadAddress: "서울 강동구 천호대로 1077",
      jibunAddress: "서울 강동구 천호동 123-4",
      display: "서울 강동구 천호대로 1077",
    });
    vi.mocked(reverseRoadAddress).mockResolvedValue(null);
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

  it("카카오 road 있음 → 그대로 반환 (NCP 호출 안 함)", async () => {
    const res = await GET(makeRequest("37.53", "127.14"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: "서울 강동구 천호대로 1077",
    });
    expect(reverseRoadAddress).not.toHaveBeenCalled();
  });

  it("카카오 road 없음 + NCP 성공 → NCP 도로명 반환", async () => {
    vi.mocked(coordToAddress).mockResolvedValue({
      jibunAddress: "서울 강동구 둔촌동 123-4",
      display: "서울 강동구 둔촌동 123-4",
    });
    vi.mocked(reverseRoadAddress).mockResolvedValue(
      "서울특별시 강동구 천호대로 1220",
    );
    const res = await GET(makeRequest("37.5354", "127.1465"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: "서울특별시 강동구 천호대로 1220",
    });
  });

  it("카카오 road 없음 + NCP도 무결과 → 지번으로 폴백", async () => {
    vi.mocked(coordToAddress).mockResolvedValue({
      jibunAddress: "서울 강동구 둔촌동 123-4",
      display: "서울 강동구 둔촌동 123-4",
    });
    vi.mocked(reverseRoadAddress).mockResolvedValue(null);
    const res = await GET(makeRequest("37.5354", "127.1465"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: "서울 강동구 둔촌동 123-4",
    });
  });

  it("카카오 road 없음 + NCP 호출 자체 실패(throw) → 지번으로 폴백", async () => {
    vi.mocked(coordToAddress).mockResolvedValue({
      jibunAddress: "서울 강동구 둔촌동 123-4",
      display: "서울 강동구 둔촌동 123-4",
    });
    vi.mocked(reverseRoadAddress).mockRejectedValue(new Error("ncp down"));
    const res = await GET(makeRequest("37.5354", "127.1465"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: "서울 강동구 둔촌동 123-4",
    });
  });

  it("NCP 키 없으면 road 없어도 NCP 호출 안 하고 바로 지번", async () => {
    vi.mocked(hasNcpMapsKeys).mockReturnValue(false);
    vi.mocked(coordToAddress).mockResolvedValue({
      jibunAddress: "서울 강동구 둔촌동 123-4",
      display: "서울 강동구 둔촌동 123-4",
    });
    const res = await GET(makeRequest("37.5354", "127.1465"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: "서울 강동구 둔촌동 123-4",
    });
    expect(reverseRoadAddress).not.toHaveBeenCalled();
  });

  it("매칭 없음 → address null (3-state: 실패 아님)", async () => {
    vi.mocked(coordToAddress).mockResolvedValue(null);
    vi.mocked(reverseRoadAddress).mockResolvedValue(null);
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
