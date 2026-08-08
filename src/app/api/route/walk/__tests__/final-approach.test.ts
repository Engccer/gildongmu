import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `finalApproach`는 **라우트 핸들러가 요청받은 원좌표로 계산한다**는 계약
 * (spec 2026-08-08 §3.1). provider URL은 `roundCoord(…,4)`(±5.5m)로 목적지를
 * 뭉치므로 같은 셀의 다른 목적지가 캐시 엔트리를 공유한다 — 거기에 기하를 실으면
 * 옆 건물의 방향을 말한다.
 *
 * 여기서는 서비스(`getWalkRoute`)를 mock한다. provider 계층 동작은 형제
 * `route.test.ts`가 덮고, 이 파일은 "핸들러가 어느 좌표를 쓰는가"만 본다.
 */
vi.mock("@/lib/env", () => ({ hasWalkRouteKey: vi.fn(() => true) }));
vi.mock("@/lib/rate-limit", () => ({
  checkWalkRateLimit: vi.fn(() => true),
  clientIpFromHeaders: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/walk-route", () => ({ getWalkRoute: vi.fn() }));

import { GET } from "../route";
import { getWalkRoute } from "@/lib/walk-route";

/** 종점이 (37.5, 127.1)인 남→북 100m 직선 경로. */
const briefingWithGeometry = () => ({
  distanceMeters: 100,
  durationSeconds: 90,
  steps: [
    {
      description: "성내로를 따라 100m 이동",
      distanceMeters: 100,
      pathCoords: [
        { lat: 37.5 - 100 / 111320, lng: 127.1 },
        { lat: 37.5, lng: 127.1 },
      ],
    },
  ],
});

const eastOfEnd = (meters: number) => ({
  lat: 37.5,
  lng: 127.1 + meters / (111320 * Math.cos((37.5 * Math.PI) / 180)),
});

const call = (dest: { lat: number; lng: number }, geometry = true) =>
  GET(
    new NextRequest(
      `http://x/api/route/walk?origin=37.499,127.1&dest=${dest.lat},${dest.lng}` +
        (geometry ? "&includeGeometry=1" : ""),
    ),
  );

describe("GET /api/route/walk finalApproach", () => {
  beforeEach(() => {
    vi.mocked(getWalkRoute).mockResolvedValue(briefingWithGeometry() as never);
  });

  it("요청받은 원좌표로 계산해 응답에 싣는다", async () => {
    const body = await (await call(eastOfEnd(30))).json();
    expect(body.result.finalApproach.offsetMeters).toBeCloseTo(30, 0);
    expect(body.result.finalApproach.relativeBearing).toBeCloseTo(90, 0);
  });

  it("같은 반올림 셀의 다른 목적지가 다른 값을 받는다(캐시 공유 금지)", async () => {
    const a = await (await call(eastOfEnd(30))).json();
    // +0.00003도 ≈ 2.6m. roundCoord(…,4)로는 같은 셀이라 provider 캐시를 공유한다.
    const b = await (
      await call({ lat: 37.5, lng: eastOfEnd(30).lng + 0.00003 })
    ).json();
    expect(
      Math.abs(
        a.result.finalApproach.offsetMeters - b.result.finalApproach.offsetMeters,
      ),
    ).toBeGreaterThan(2);
  });

  it("오프셋이 하한 미만이면 방향 없이 사유만 싣는다", async () => {
    const body = await (await call(eastOfEnd(4))).json();
    expect(body.result.finalApproach.bearingUnavailable).toBe("tooClose");
    expect(body.result.finalApproach.relativeBearing).toBeUndefined();
  });

  it("includeGeometry 미요청이면 싣지 않는다", async () => {
    const body = await (await call(eastOfEnd(30), false)).json();
    expect(body.result.finalApproach).toBeUndefined();
  });

  it("기하가 없으면 필드를 싣지 않는다", async () => {
    vi.mocked(getWalkRoute).mockResolvedValue({
      distanceMeters: 100,
      durationSeconds: 90,
      steps: [{ description: "x", distanceMeters: 100 }],
    } as never);
    const body = await (await call(eastOfEnd(30))).json();
    expect(body.result.finalApproach).toBeUndefined();
  });

  it("경로 자체가 없으면(null) 그대로 통과시킨다", async () => {
    vi.mocked(getWalkRoute).mockResolvedValue(null);
    const body = await (await call(eastOfEnd(30))).json();
    expect(body.result).toBeNull();
  });
});
