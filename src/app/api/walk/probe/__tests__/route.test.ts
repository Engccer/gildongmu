import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  checkWalkRateLimit: vi.fn(() => true),
  clientIpFromHeaders: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/env", () => ({ hasKakaoKey: vi.fn(() => true) }));
vi.mock("@/lib/walk-probe", () => ({ getWalkProbe: vi.fn() }));

import { GET } from "../route";
import { checkWalkRateLimit } from "@/lib/rate-limit";
import { hasKakaoKey } from "@/lib/env";
import { getWalkProbe } from "@/lib/walk-probe";

const mockProbe = vi.mocked(getWalkProbe);
const req = (q: string) => new NextRequest(`http://x/api/walk/probe${q}`);

describe("GET /api/walk/probe", () => {
  beforeEach(() => {
    mockProbe.mockReset();
    mockProbe.mockResolvedValue({ crosswalks: [{ lat: 37.5, lng: 127.0 }], turns: [] });
    vi.mocked(checkWalkRateLimit).mockReturnValue(true);
    vi.mocked(hasKakaoKey).mockReturnValue(true);
  });

  it("정상 → 200 {probe}, 캐시 금지 헤더(카카오 결과 저장 금지)", async () => {
    const res = await GET(req("?lat=37.5&lng=127.0&bearing=45"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ probe: { crosswalks: [{ lat: 37.5, lng: 127.0 }], turns: [] } });
    expect(mockProbe).toHaveBeenCalledWith(37.5, 127.0, 45);
  });

  it("방위 누락·빈 값·범위 밖 → 400(정북으로 위장하지 않는다), upstream 미호출", async () => {
    for (const q of ["?lat=37.5&lng=127.0", "?lat=37.5&lng=127.0&bearing=", "?lat=37.5&lng=127.0&bearing=400"]) {
      expect((await GET(req(q))).status).toBe(400);
    }
    expect((await GET(req("?lng=127.0&bearing=10"))).status).toBe(400);
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it("한국 밖 → 200 outOfCoverage, upstream 미호출", async () => {
    const res = await GET(req("?lat=35.68&lng=139.76&bearing=10"));
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it("키 없음 404 · 레이트리밋 429 · upstream 실패 502", async () => {
    vi.mocked(hasKakaoKey).mockReturnValueOnce(false);
    expect((await GET(req("?lat=37.5&lng=127.0&bearing=10"))).status).toBe(404);
    vi.mocked(checkWalkRateLimit).mockReturnValueOnce(false);
    expect((await GET(req("?lat=37.5&lng=127.0&bearing=10"))).status).toBe(429);
    mockProbe.mockRejectedValueOnce(new Error("카카오 장애"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET(req("?lat=37.5&lng=127.0&bearing=10"))).status).toBe(502);
  });
});
