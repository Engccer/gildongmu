import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasKakaoKey: vi.fn(() => true),
}));
vi.mock("@/lib/providers/surroundings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/surroundings")>()),
  findSurroundingsNear: vi.fn(),
}));

import { GET } from "../route";
import { hasKakaoKey } from "@/lib/env";
import { ALL_CATEGORY_GROUPS, findSurroundingsNear } from "@/lib/providers/surroundings";

const mockHasKey = vi.mocked(hasKakaoKey);
const mockFind = vi.mocked(findSurroundingsNear);

/** 라우트는 항목 내부를 해석하지 않으므로 id만 있는 최소 fixture로 충분. */
const FIFTY = Array.from({ length: 50 }, (_, i) => ({ id: `p-${i}` }));
const HUNDRED_TEN = Array.from({ length: 110 }, (_, i) => ({ id: `p-${i}` }));

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/places/around${query}`);
}

describe("GET /api/places/around (옵트인 limit 계약)", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockFind.mockReset();
    mockFind.mockResolvedValue(FIFTY as never);
  });

  it("limit 미지정 → 기본 상한 12 + 절단 전 total", async () => {
    const res = await GET(makeRequest("?lat=37.5&lng=127.1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.places.length).toBe(12);
    expect(body.places[0].id).toBe("p-0");
    expect(body.total).toBe(50);
  });

  it("limit=50 → 50건 확장(옵트인)", async () => {
    const res = await GET(makeRequest("?lat=37.5&lng=127.1&limit=50"));
    const body = await res.json();
    expect(body.places.length).toBe(50);
    expect(body.total).toBe(50);
  });

  it("limit=51 → 400 (최대 50)", async () => {
    const res = await GET(makeRequest("?lat=37.5&lng=127.1&limit=51"));
    expect(res.status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("limit=0·비정수 → 400", async () => {
    expect((await GET(makeRequest("?lat=37.5&lng=127.1&limit=0"))).status).toBe(400);
    expect((await GET(makeRequest("?lat=37.5&lng=127.1&limit=abc"))).status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("키 없음 → { places: [], total: 0 } (게이트 이중 방어)", async () => {
    mockHasKey.mockReturnValue(false);
    const res = await GET(makeRequest("?lat=37.5&lng=127.1&limit=50"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ places: [], total: 0 });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("provider throw → 502 (빈 결과와 구분)", async () => {
    mockFind.mockRejectedValue(new Error("upstream"));
    const res = await GET(makeRequest("?lat=37.5&lng=127.1"));
    expect(res.status).toBe(502);
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

describe("GET /api/places/around (나들이 groups=all 옵트인, E58 ②)", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockFind.mockReset();
    mockFind.mockResolvedValue(HUNDRED_TEN as never);
  });

  it("groups 미지정은 provider를 인자 둘로만 부른다 — 기본 응답(10종·상한 50) 불변", async () => {
    const res = await GET(makeRequest("?lat=37.5&lng=127.1&limit=50"));
    expect(res.status).toBe(200);
    expect(mockFind).toHaveBeenCalledTimes(1);
    expect(mockFind.mock.calls[0]).toEqual([37.5, 127.1]);
    expect(mockFind.mock.calls[0]).toHaveLength(2);
  });

  it("groups=all → 18종·상한 100으로 조회하고 limit 100까지 싣는다", async () => {
    const res = await GET(makeRequest("?lat=37.5&lng=127.1&groups=all&limit=100"));
    expect(res.status).toBe(200);
    expect(mockFind.mock.calls[0]).toEqual([37.5, 127.1, { groups: ALL_CATEGORY_GROUPS, cap: 100 }]);
    expect(ALL_CATEGORY_GROUPS).toHaveLength(18);
    const body = await res.json();
    expect(body.places.length).toBe(100);
    expect(body.total).toBe(110);
  });

  it("groups=all에 limit이 없으면 기본 상한 12", async () => {
    const body = await (await GET(makeRequest("?lat=37.5&lng=127.1&groups=all"))).json();
    expect(body.places.length).toBe(12);
  });

  it("groups 없이 limit 51~100 → 400(종전 상한 유지), groups=all이어도 101 → 400", async () => {
    expect((await GET(makeRequest("?lat=37.5&lng=127.1&limit=60"))).status).toBe(400);
    expect((await GET(makeRequest("?lat=37.5&lng=127.1&groups=all&limit=101"))).status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("groups의 미지 값 → 400(조용히 기본으로 접지 않는다)", async () => {
    expect((await GET(makeRequest("?lat=37.5&lng=127.1&groups=default"))).status).toBe(400);
    expect((await GET(makeRequest("?lat=37.5&lng=127.1&groups=CS2,SC4"))).status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("groups=all도 한국 밖이면 outOfCoverage가 키 게이트보다 앞이다", async () => {
    const res = await GET(makeRequest("?lat=37.7749&lng=-122.4194&groups=all&limit=100"));
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(mockFind).not.toHaveBeenCalled();
  });
});
