import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasWalkRouteKey: vi.fn(() => true),
  // walk-route 서비스 내부 provider 선택용(라우트 자체 게이트와 별개) — 이 라우트
  // 테스트는 Tmap 단독 경로를 검증하므로 카카오는 항상 false(카카오 provider는
  // 별도 mock 없음), Tmap은 true 고정.
  hasTmapKey: vi.fn(() => true),
  hasKakaoKey: vi.fn(() => false),
}));
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
import { hasWalkRouteKey } from "@/lib/env";
import { checkWalkRateLimit } from "@/lib/rate-limit";
import { getWalkRouteBriefing } from "@/lib/providers/tmap-pedestrian";

function makeRequest(origin: string, dest: string, accessible?: string) {
  const params = new URLSearchParams({ origin, dest });
  if (accessible !== undefined) params.set("accessible", accessible);
  return new NextRequest(`http://x/api/route/walk?${params.toString()}`);
}

describe("GET /api/route/walk", () => {
  beforeEach(() => {
    vi.mocked(hasWalkRouteKey).mockReturnValue(true);
    vi.mocked(checkWalkRateLimit).mockReturnValue(true);
  });

  it("origin 형식 오류 → 400", async () => {
    const res = await GET(makeRequest("not-a-coord", "37.6,127.1"));
    expect(res.status).toBe(400);
  });

  it("키 없음(hasWalkRouteKey false)은 404 유지", async () => {
    vi.mocked(hasWalkRouteKey).mockReturnValue(false);
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

  it("accessible=true는 서비스에 전달된다(카카오 없음→Tmap 경유라 stepFree:unavailable로 관측)", async () => {
    // getWalkRoute(서비스)를 직접 mock하지 않고 위 "배선 계약" 테스트와 동일하게
    // 실서비스를 경유시킨다 — accessible=true 전달 여부는 그 효과(stepFree 필드+
    // 안내 스텝 삽입)로 간접 검증한다.
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1", "true"));
    const body = await res.json();
    expect(body.result.stepFree).toBe("unavailable");
    expect(body.result.steps[0].description).toContain(
      "계단 회피 경로를 조회하지 못했습니다",
    );
  });

  it("accessible 오입력(1·yes·True)은 400 — 안전 옵션을 기본 모드로 조용히 강등하지 않는다", async () => {
    for (const bad of ["1", "yes", "True"]) {
      const res = await GET(makeRequest("37.5,127.0", "37.6,127.1", bad));
      expect(res.status).toBe(400);
    }
  });
});
