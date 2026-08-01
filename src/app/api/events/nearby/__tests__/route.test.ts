import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasSeoulOpenDataKey: vi.fn(() => true),
}));
vi.mock("@/lib/culture-events", () => ({
  findEventsNear: vi.fn(),
}));

import { GET } from "../route";
import { hasSeoulOpenDataKey } from "@/lib/env";
import { findEventsNear } from "@/lib/culture-events";

const mockHasKey = vi.mocked(hasSeoulOpenDataKey);
const mockFind = vi.mocked(findEventsNear);

/** 라우트는 항목 내부를 해석하지 않으므로 id만 있는 최소 fixture로 충분. */
const FIFTY = Array.from({ length: 50 }, (_, i) => ({ id: `e-${i}` }));

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/events/nearby${query}`);
}

describe("GET /api/events/nearby", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockFind.mockReset();
    mockFind.mockResolvedValue({ events: FIFTY, total: 84 } as never);
  });

  it("limit 미지정 → 기본 상한 12 + 반경 내 절단 전 total", async () => {
    const res = await GET(makeRequest("?lat=37.5665&lng=126.978"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(12);
    expect(body.events[0].id).toBe("e-0");
    expect(body.total).toBe(84);
  });

  it("limit=50 → 50건 확장(옵트인, '더 보기' 클라이언트용)", async () => {
    const body = await (await GET(makeRequest("?lat=37.5665&lng=126.978&limit=50"))).json();
    expect(body.events.length).toBe(50);
    expect(body.total).toBe(84);
  });

  it("limit 범위 밖·비정수 → 400, upstream 미호출", async () => {
    expect((await GET(makeRequest("?lat=37.5&lng=127&limit=51"))).status).toBe(400);
    expect((await GET(makeRequest("?lat=37.5&lng=127&limit=0"))).status).toBe(400);
    expect((await GET(makeRequest("?lat=37.5&lng=127&limit=1.5"))).status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("좌표 결측·전지구 범위 밖 → 400", async () => {
    expect((await GET(makeRequest(""))).status).toBe(400);
    expect((await GET(makeRequest("?lat=91&lng=127"))).status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("국외 좌표 → outOfCoverage 마커, 키 게이트보다 앞(upstream 미호출)", async () => {
    mockHasKey.mockReturnValue(false); // 게이트가 뒤라는 것을 증명
    const res = await GET(makeRequest("?lat=35.68&lng=139.69")); // 도쿄
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("키 없음 → 빈 배열(이중 방어), upstream 미호출", async () => {
    mockHasKey.mockReturnValue(false);
    const res = await GET(makeRequest("?lat=37.5665&lng=126.978"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [], total: 0 });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("서울 밖 국내 좌표에서 0건 → 빈 배열 graceful (오류 아님)", async () => {
    mockFind.mockResolvedValue({ events: [], total: 0 } as never);
    const res = await GET(makeRequest("?lat=35.1796&lng=129.0756")); // 부산
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [], total: 0 });
  });

  it("upstream 장애 → 502 (조회 실패와 '근처에 없음'을 구분)", async () => {
    mockFind.mockRejectedValue(new Error("culturalEventInfo ERROR-500"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(makeRequest("?lat=37.5665&lng=126.978"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBeTruthy();
  });
});
