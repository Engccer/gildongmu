import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasDataGoKrKey: vi.fn(() => true),
}));
vi.mock("@/lib/providers/tour-barrier-free", () => ({
  matchBarrierFreePlace: vi.fn(),
}));

import { GET } from "../route";
import { matchBarrierFreePlace } from "@/lib/providers/tour-barrier-free";

const mockMatch = vi.mocked(matchBarrierFreePlace);

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/places/barrier-free/match${query}`);
}

/**
 * 이 라우트만 좌표 범위가 **한국 bbox**(33~43, 124~132)라 (0, 0)이 애초에 통과하지
 * 못한다 — 백로그 D3이 정적 패턴으로 센 14곳 중 유일하게 **행동 결함이 없던** 곳이다.
 * 그래도 헬퍼로 통일하는 이유는 다음 사람이 범위를 전지구로 넓히는 순간 함정이
 * 되살아나기 때문이고, 이 스위트는 그때 빨개지라고 둔다(수정이 아니라 잠금).
 *
 * 또 이 라우트는 파싱 실패를 400이 아니라 `{detail:null}`로 답한다(매칭 보조라
 * 조용한 미노출이 계약). 그 비대칭도 함께 못 박는다.
 */
describe("GET /api/places/barrier-free/match 좌표 파라미터 (D3 잠금)", () => {
  beforeEach(() => {
    mockMatch.mockReset();
    mockMatch.mockResolvedValue(null as never);
  });

  it("좌표 결측 → detail null, upstream 미호출 (400 아님)", async () => {
    const res = await GET(makeRequest("?name=경복궁"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detail: null });
    expect(mockMatch).not.toHaveBeenCalled();
  });

  it("빈 문자열 좌표 → detail null, upstream 미호출", async () => {
    await GET(makeRequest("?name=경복궁&lat=&lng="));
    expect(mockMatch).not.toHaveBeenCalled();
  });

  it("한국 밖 좌표 → detail null (bbox 밖은 매칭 대상이 아니다)", async () => {
    await GET(makeRequest("?name=Eiffel&lat=48.85&lng=2.35"));
    expect(mockMatch).not.toHaveBeenCalled();
  });

  it("정상 좌표+이름 → upstream 호출", async () => {
    await GET(makeRequest("?name=경복궁&lat=37.5796&lng=126.977"));
    expect(mockMatch).toHaveBeenCalledWith({ name: "경복궁", lat: 37.5796, lng: 126.977 });
  });
});
