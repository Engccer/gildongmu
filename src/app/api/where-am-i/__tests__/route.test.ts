import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasKakaoKey: vi.fn(() => true),
}));
vi.mock("@/lib/where-am-i", () => ({
  assembleWhereAmI: vi.fn(),
}));

import { GET } from "../route";
import { hasKakaoKey } from "@/lib/env";
import { assembleWhereAmI } from "@/lib/where-am-i";

const mockHasKey = vi.mocked(hasKakaoKey);
const mockAssemble = vi.mocked(assembleWhereAmI);

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/where-am-i${query}`);
}

describe("GET /api/where-am-i (커버리지 마커 계약)", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockAssemble.mockReset();
  });

  it("한국 밖 좌표는 200 outOfCoverage 마커(upstream 미호출)", async () => {
    const res = await GET(makeRequest("?lat=37.7749&lng=-122.4194"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(mockAssemble).not.toHaveBeenCalled();
  });

  it("전지구 범위 밖 좌표는 여전히 400", async () => {
    const res = await GET(makeRequest("?lat=95&lng=200"));
    expect(res.status).toBe(400);
  });
});
