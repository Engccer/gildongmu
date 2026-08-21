import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/nearby-overview", () => ({ assembleNearbyOverview: vi.fn() }));

import { GET } from "../route";
import { assembleNearbyOverview } from "@/lib/nearby-overview";

const mockAssemble = vi.mocked(assembleNearbyOverview);
const req = (qs: string) => new NextRequest(`http://x/api/nearby/overview${qs}`);

beforeEach(() => {
  mockAssemble.mockReset();
});

describe("GET /api/nearby/overview", () => {
  it("좌표 누락은 400 — (0,0)으로 흘려보내지 않는다", async () => {
    expect((await GET(req("?lng=127.0"))).status).toBe(400);
    expect(mockAssemble).not.toHaveBeenCalled();
  });

  it("한국 밖은 200 outOfCoverage (upstream 미호출)", async () => {
    const res = await GET(req("?lat=48.85&lng=2.35")); // 파리(bbox 밖 — 후쿠오카는 bbox 안, E19)
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(mockAssemble).not.toHaveBeenCalled();
  });

  it("정상은 { data }", async () => {
    const data = { place: "x", radiusMeters: 1000, bullets: [{ kind: "transit", state: "ok", station: null, busStops: null }] };
    mockAssemble.mockResolvedValue(data as never);
    expect(await (await GET(req("?lat=37.5385&lng=127.143"))).json()).toEqual({ data });
  });

  it("불릿이 하나도 없고 place도 없으면 data null (전 키 부재)", async () => {
    mockAssemble.mockResolvedValue({ place: null, radiusMeters: 1000, bullets: [] });
    expect(await (await GET(req("?lat=37.5385&lng=127.143"))).json()).toEqual({ data: null });
  });

  it("조립 예외는 502", async () => {
    mockAssemble.mockRejectedValue(new Error("boom"));
    expect((await GET(req("?lat=37.5385&lng=127.143"))).status).toBe(502);
  });
});
