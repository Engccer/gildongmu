import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/providers/places", () => ({
  searchPlaces: vi.fn(),
}));

import { GET } from "../route";
import { searchPlaces } from "@/lib/providers/places";

const mockSearch = vi.mocked(searchPlaces);

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/places${query}`);
}

/**
 * 이 라우트에서 좌표는 **선택**이다(있으면 근접 블렌딩과 거리 주석, 없으면 그냥 검색).
 * 그래서 누락은 400이 아니라 "좌표 없이 검색"이 정답이고, 결함은 다른 모양으로 난다:
 * 빈 문자열이 `Number("") === 0`으로 (0,0)이 되면 **적도 앞바다를 기준으로 근접
 * 블렌딩과 거리 주석이 붙는다**(백로그 D3의 이 라우트 판).
 */
describe("GET /api/places 좌표 파라미터 (D3)", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({ places: [] } as never);
  });

  it("좌표 없음 → 400이 아니라 좌표 없이 검색(선택 파라미터 계약)", async () => {
    const res = await GET(makeRequest("?query=강남역"));
    expect(res.status).toBe(200);
    expect(mockSearch.mock.calls[0][0].lat).toBeUndefined();
    expect(mockSearch.mock.calls[0][0].lng).toBeUndefined();
  });

  it("빈 문자열 좌표도 좌표 없음으로 다룬다 ((0,0) 블렌딩 금지)", async () => {
    await GET(makeRequest("?query=강남역&lat=&lng="));
    expect(mockSearch.mock.calls[0][0].lat).toBeUndefined();
    expect(mockSearch.mock.calls[0][0].lng).toBeUndefined();
  });

  it("정상 좌표는 그대로 전달한다", async () => {
    await GET(makeRequest("?query=강남역&lat=37.4979&lng=127.0276"));
    expect(mockSearch.mock.calls[0][0].lat).toBe(37.4979);
    expect(mockSearch.mock.calls[0][0].lng).toBe(127.0276);
  });
});
