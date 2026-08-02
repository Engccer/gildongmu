import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasSeoulOpenDataKey: vi.fn(() => true),
}));
// isBikeServiceArea는 **실제 구현**을 쓴다(순수 좌표 판정). 모킹하면 라우트가
// 진짜 판정선을 쓰는지 검증하지 못한다 — 서울 인접 좌표가 잘리는 회귀가 통과한다.
vi.mock("@/lib/providers/seoul-bike", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/seoul-bike")>()),
  fetchNearbyBikeStations: vi.fn(),
}));

import { GET } from "../route";
import { hasSeoulOpenDataKey } from "@/lib/env";
import { fetchNearbyBikeStations } from "@/lib/providers/seoul-bike";

const mockHasKey = vi.mocked(hasSeoulOpenDataKey);
const mockFetch = vi.mocked(fetchNearbyBikeStations);

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/bike/nearby${query}`);
}

describe("GET /api/bike/nearby (커버리지 마커 계약)", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockFetch.mockReset();
  });

  it("한국 밖 좌표는 200 outOfCoverage 마커(upstream 미호출)", async () => {
    const res = await GET(makeRequest("?lat=37.7749&lng=-122.4194"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("전지구 범위 밖 좌표는 여전히 400", async () => {
    const res = await GET(makeRequest("?lat=95&lng=200"));
    expect(res.status).toBe(400);
  });

  it("서울 밖 국내 좌표는 unavailableHere 마커, 키 게이트보다 앞(upstream 미호출)", async () => {
    // 대여소가 서울 안에만 있으므로 부산의 0건은 "지금 근처에 없다"가 아니라
    // "이 지역에 서비스가 없다"다. 뭉개면 사용자가 반경을 넓힐 여지를 상상한다.
    mockHasKey.mockReturnValue(false); // 게이트가 뒤라는 것을 증명
    const res = await GET(makeRequest("?lat=35.1796&lng=129.0756")); // 부산
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unavailableHere: "seoulOnly" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("서울 인접 시(하남 미사)는 서비스권 — 조회한다", async () => {
    // 최근접 대여소 1.13km(실측). 조회 반경 1km 밖이라 0건이지만 "미제공"이라
    // 말하면 거짓이다. 이 케이스가 시도 경계로 자르지 않는 근거다.
    mockFetch.mockResolvedValue([]);
    const res = await GET(makeRequest("?lat=37.562&lng=127.193"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stations: [] });
    expect(mockFetch).toHaveBeenCalled();
  });
});

/**
 * 좌표 파라미터 누락은 400이다 — `Number("") === 0`으로 (0,0)이 되면
 * `isInKorea`가 false라 **400이어야 할 요청이 200 outOfCoverage로 위장**된다
 * (백로그 D3, 정본 헬퍼 `@/lib/coord-param`).
 */
describe("좌표 파라미터 누락 (D3)", () => {
  it("lat·lng 없음 → 400 (outOfCoverage 위장 금지)", async () => {
    expect((await GET(makeRequest(""))).status).toBe(400);
  });

  it("빈 문자열 좌표 → 400", async () => {
    expect((await GET(makeRequest("?lat=&lng="))).status).toBe(400);
  });
});
