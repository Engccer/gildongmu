import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasKakaoKey: vi.fn(() => true),
}));
vi.mock("@/lib/providers/surroundings", () => ({
  findSurroundingsNear: vi.fn(),
}));

import { GET } from "../route";
import { hasKakaoKey } from "@/lib/env";
import { findSurroundingsNear } from "@/lib/providers/surroundings";

const mockHasKey = vi.mocked(hasKakaoKey);
const mockFind = vi.mocked(findSurroundingsNear);

/** 라우트는 항목 내부를 해석하지 않으므로 id만 있는 최소 fixture로 충분. */
const FIFTY = Array.from({ length: 50 }, (_, i) => ({ id: `p-${i}` }));

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
