import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasSeoulOpenDataKey: vi.fn(() => true),
}));
// isEventServiceArea는 **실제 구현**을 쓴다(순수 좌표 판정) — 모킹하면 라우트가
// 진짜 판정선을 쓰는지 검증하지 못하고, 서울 인접 좌표가 잘리는 회귀를 놓친다.
vi.mock("@/lib/culture-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/culture-events")>()),
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

  it("서울 밖 국내 좌표 → unavailableHere 마커, 키 게이트보다 앞(upstream 미호출)", async () => {
    // 출처가 서울 데이터뿐이라 부산의 0건은 "오늘 행사 없음"이 아니라 "정보 미보유"다.
    // 둘을 뭉개면 데이터 한계가 지역의 부재로 위장된다.
    mockHasKey.mockReturnValue(false); // 게이트가 뒤라는 것을 증명
    const res = await GET(makeRequest("?lat=35.1796&lng=129.0756")); // 부산
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unavailableHere: "seoulOnly" });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("서울 인접 시(하남 미사)는 서비스권 — 조회한다", async () => {
    // 반경 3km가 서울 경계를 넘어 실제로 서울 행사가 잡힌다(2026-08-02 실호출 1건).
    // 시도 경계로 잘랐다면 사라졌을 결과라, 이 케이스가 판정 방식의 근거다.
    mockFind.mockResolvedValue({ events: [], total: 0 } as never);
    const res = await GET(makeRequest("?lat=37.562&lng=127.193"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [], total: 0 });
    expect(mockFind).toHaveBeenCalled();
  });

  it("upstream 장애 → 502 (조회 실패와 '근처에 없음'을 구분)", async () => {
    mockFind.mockRejectedValue(new Error("culturalEventInfo ERROR-500"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(makeRequest("?lat=37.5665&lng=126.978"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBeTruthy();
  });
});
