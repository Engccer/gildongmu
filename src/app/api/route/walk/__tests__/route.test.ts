import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({ hasTmapKey: vi.fn(() => true) }));
vi.mock("@/lib/rate-limit", () => ({
  checkWalkRateLimit: vi.fn(() => true),
  clientIpFromHeaders: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/providers/tmap-pedestrian", () => ({
  getWalkRouteBriefing: vi.fn(async () => ({
    distanceMeters: 500,
    durationSeconds: 400,
    steps: [{ description: "158m 이동 후 우회전" }],
  })),
}));

import { GET } from "../route";
import { hasTmapKey } from "@/lib/env";
import { checkWalkRateLimit } from "@/lib/rate-limit";
import { getWalkRouteBriefing } from "@/lib/providers/tmap-pedestrian";

function makeRequest(origin: string, dest: string) {
  return new NextRequest(
    `http://x/api/route/walk?origin=${encodeURIComponent(origin)}&dest=${encodeURIComponent(dest)}`,
  );
}

describe("GET /api/route/walk", () => {
  beforeEach(() => {
    vi.mocked(hasTmapKey).mockReturnValue(true);
    vi.mocked(checkWalkRateLimit).mockReturnValue(true);
  });

  it("origin 형식 오류 → 400", async () => {
    const res = await GET(makeRequest("not-a-coord", "37.6,127.1"));
    expect(res.status).toBe(400);
  });

  it("키 없으면 → 404", async () => {
    vi.mocked(hasTmapKey).mockReturnValue(false);
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(404);
  });

  it("정상 경로 → {result} shape", async () => {
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toEqual({
      distanceMeters: 500,
      durationSeconds: 400,
      steps: [{ description: "158m 이동 후 우회전" }],
    });
  });

  it("배선 계약: walk-route 서비스를 경유해 주석이 반영되고 coord는 응답에 없다", async () => {
    // 라우트가 provider 직접 호출로 회귀하면 이 테스트가 잡는다(주석·coord 제거는
    // walk-route 서비스 책임). 좌표는 실제 seed 지점을 써서 40m 매칭을 성립시킨다.
    const seed = (await import("@/lib/data/audio-signals.json")) as unknown as {
      signals: [number, number][];
    };
    const [lat, lng] = seed.signals[0];
    vi.mocked(getWalkRouteBriefing).mockResolvedValueOnce({
      distanceMeters: 500,
      durationSeconds: 400,
      steps: [{ description: "우측 횡단보도 후 11m 이동", coord: { lat, lng } }],
    });
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    const body = await res.json();
    expect(body.result.steps).toEqual([
      { description: "우측 횡단보도 후 11m 이동, 음향신호기 있음" },
    ]);
  });

  it("provider throw → 502", async () => {
    vi.mocked(getWalkRouteBriefing).mockRejectedValueOnce(new Error("fail"));
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(502);
  });

  it("경로 없음(provider null, 예: Tmap 3102) → 200 {result: null}", async () => {
    vi.mocked(getWalkRouteBriefing).mockResolvedValueOnce(null);
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBeNull();
  });

  it("레이트리밋 초과 → 429", async () => {
    vi.mocked(checkWalkRateLimit).mockReturnValue(false);
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(429);
  });
});
