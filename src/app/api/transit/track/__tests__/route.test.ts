import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  checkTransitTrackRateLimit: vi.fn(() => true),
  clientIpFromHeaders: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/transit-track", () => ({
  trackSeoulWait: vi.fn(async () => ({ status: "ok", items: [{ vehicleId: "1" }] })),
  trackSeoulRide: vi.fn(async () => ({ status: "empty" })),
  resolveTagoStop: vi.fn(async () => ({
    status: "ok",
    stop: { nodeId: "DJB1", cityCode: "25", name: "시청" },
  })),
  trackTago: vi.fn(async () => ({ status: "ok", items: [] })),
  trackSubway: vi.fn(async () => ({ status: "unsupported" })),
}));

import { GET } from "../route";
import { checkTransitTrackRateLimit } from "@/lib/rate-limit";
import {
  resolveTagoStop,
  trackSeoulRide,
  trackSeoulWait,
  trackSubway,
} from "@/lib/transit-track";

function makeRequest(params: Record<string, string>) {
  return new NextRequest(`http://x/api/transit/track?${new URLSearchParams(params)}`);
}

describe("GET /api/transit/track — 판별 union(B2 §7)", () => {
  beforeEach(() => {
    vi.mocked(checkTransitTrackRateLimit).mockReturnValue(true);
    vi.mocked(trackSeoulWait).mockClear();
  });

  it("seoulBus wait: 검증 통과 시 서비스로 전달, mode를 되돌려준다", async () => {
    const res = await GET(
      makeRequest({ mode: "seoulBus", phase: "wait", arsId: "24101", routeId: "227000006" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("seoulBus");
    expect(body.status).toBe("ok");
    expect(trackSeoulWait).toHaveBeenCalledWith({ arsId: "24101", routeId: "227000006" });
  });

  it("seoulBus ride: boardId·alightId를 로컬 ID로 매핑", async () => {
    const res = await GET(
      makeRequest({
        mode: "seoulBus", phase: "ride",
        routeId: "227000006", boardId: "123000017", alightId: "123000043",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("empty");
    expect(trackSeoulRide).toHaveBeenCalledWith({
      routeId: "227000006",
      boardLocalId: "123000017",
      alightLocalId: "123000043",
    });
  });

  it("tagoBus resolve: 좌표는 coord-param 규율(누락 400, (0,0) 위장 금지)", async () => {
    const ok = await GET(
      makeRequest({ mode: "tagoBus", phase: "resolve", lat: "36.33", lng: "127.43" }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).stop.nodeId).toBe("DJB1");
    const missing = await GET(makeRequest({ mode: "tagoBus", phase: "resolve", lng: "127.43" }));
    expect(missing.status).toBe(400);
    expect(resolveTagoStop).toHaveBeenCalledTimes(1);
  });

  it("subway track: station·line → 서비스 lineName", async () => {
    const res = await GET(
      makeRequest({ mode: "subway", phase: "track", station: "천호", line: "수도권 5호선" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("unsupported");
    expect(trackSubway).toHaveBeenCalledWith({ station: "천호", lineName: "수도권 5호선" });
  });

  it("알 수 없는 mode·phase 조합은 400", async () => {
    expect((await GET(makeRequest({ mode: "seoulBus", phase: "track" }))).status).toBe(400);
    expect((await GET(makeRequest({ mode: "ktx", phase: "wait" }))).status).toBe(400);
  });

  it("레이트리밋 초과 → 429(서비스 미호출)", async () => {
    vi.mocked(checkTransitTrackRateLimit).mockReturnValue(false);
    const res = await GET(
      makeRequest({ mode: "seoulBus", phase: "wait", arsId: "24101", routeId: "1" }),
    );
    expect(res.status).toBe(429);
    expect(trackSeoulWait).not.toHaveBeenCalled();
  });

  it("서비스 throw → 502(empty와 뭉개지 않는다)", async () => {
    vi.mocked(trackSeoulWait).mockRejectedValueOnce(new Error("upstream"));
    const res = await GET(
      makeRequest({ mode: "seoulBus", phase: "wait", arsId: "24101", routeId: "1" }),
    );
    expect(res.status).toBe(502);
  });
});
