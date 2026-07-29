import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasDataGoKrKey: vi.fn(() => true),
}));
vi.mock("@/lib/providers/weather", () => ({
  findWeatherNear: vi.fn(),
}));

import { GET } from "../route";
import { hasDataGoKrKey } from "@/lib/env";
import { findWeatherNear } from "@/lib/providers/weather";

const mockHasKey = vi.mocked(hasDataGoKrKey);
const mockFind = vi.mocked(findWeatherNear);

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/weather/nearby${query}`);
}

describe("GET /api/weather/nearby (커버리지 마커 계약)", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockFind.mockReset();
  });

  it("한국 밖 좌표는 200 outOfCoverage 마커(upstream 미호출)", async () => {
    const res = await GET(makeRequest("?lat=37.7749&lng=-122.4194"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("전지구 범위 밖 좌표는 여전히 400", async () => {
    const res = await GET(makeRequest("?lat=95&lng=200"));
    expect(res.status).toBe(400);
  });
});
