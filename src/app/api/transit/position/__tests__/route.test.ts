import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  checkTransitPositionRateLimit: vi.fn(() => true),
  clientIpFromHeaders: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/transit-position", () => ({
  trackSubwayPosition: vi.fn(async () => ({ status: "notFound", total: 3 })),
}));

import { GET } from "../route";
import { checkTransitPositionRateLimit } from "@/lib/rate-limit";
import { trackSubwayPosition } from "@/lib/transit-position";

function req(params: Record<string, string>) {
  return new NextRequest(`http://x/api/transit/position?${new URLSearchParams(params)}`);
}

describe("GET /api/transit/position(E35 §3.2)", () => {
  beforeEach(() => {
    vi.mocked(checkTransitPositionRateLimit).mockReturnValue(true);
    vi.mocked(trackSubwayPosition).mockClear();
  });

  it("검증 통과 시 노선·열차번호를 넘기고 결과를 그대로 돌려준다(no-store)", async () => {
    const res = await GET(req({ line: "수도권 5호선", train: "5128" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "notFound", total: 3 });
    expect(trackSubwayPosition).toHaveBeenCalledWith({ lineName: "수도권 5호선", trainNo: "5128" });
  });

  it("열차번호 형식 밖·누락은 400(upstream 미호출)", async () => {
    for (const p of [{ line: "수도권 5호선" }, { line: "수도권 5호선", train: "51/28" }, { train: "5128" }]) {
      const res = await GET(req(p as Record<string, string>));
      expect(res.status).toBe(400);
    }
    expect(trackSubwayPosition).not.toHaveBeenCalled();
  });

  it("레이트 리밋 초과는 429", async () => {
    vi.mocked(checkTransitPositionRateLimit).mockReturnValue(false);
    const res = await GET(req({ line: "수도권 5호선", train: "5128" }));
    expect(res.status).toBe(429);
  });

  it("upstream 실패는 502 — notFound로 뭉개지 않는다", async () => {
    vi.mocked(trackSubwayPosition).mockRejectedValueOnce(new Error("boom"));
    const res = await GET(req({ line: "수도권 5호선", train: "5128" }));
    expect(res.status).toBe(502);
  });
});
