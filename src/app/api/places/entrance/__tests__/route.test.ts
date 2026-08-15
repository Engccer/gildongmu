import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasKakaoKey: vi.fn(() => true),
}));
vi.mock("@/lib/providers/kakao-local", () => ({
  searchEntranceCandidatesKakao: vi.fn(),
}));

import { GET } from "../route";
import { hasKakaoKey } from "@/lib/env";
import { searchEntranceCandidatesKakao } from "@/lib/providers/kakao-local";

const mockHasKey = vi.mocked(hasKakaoKey);
const mockSearch = vi.mocked(searchEntranceCandidatesKakao);

/** 신명중학교(대표 좌표)와 그 정문 — 실호출 값과 같은 규모(56m). */
const DEST = { lat: 37.5414908976502, lng: 127.149537456547 };
const GATE = {
  place_name: "신명중학교 정문",
  category_name: "교통,수송 > 입출구",
  y: "37.5416844488666",
  x: "127.148953976455",
};

function makeRequest(query: string) {
  return new NextRequest(`http://x/api/places/entrance${query}`);
}

describe("GET /api/places/entrance", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockSearch.mockReset();
    mockSearch.mockResolvedValue([GATE] as never);
  });

  it("출입구를 찾으면 승격 좌표와 승격 폭을 준다", async () => {
    const res = await GET(
      makeRequest(`?name=${encodeURIComponent("신명중학교")}&lat=${DEST.lat}&lng=${DEST.lng}&fromLat=37.535&fromLng=127.144`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entrance.name).toBe("신명중학교 정문");
    expect(body.entrance.meters).toBeGreaterThan(40);
    expect(body.entrance.meters).toBeLessThan(80);
  });

  it("자격 후보가 없으면 200 entrance:null (오류가 아니라 승격 없음)", async () => {
    mockSearch.mockResolvedValue([
      {
        place_name: "파크리오아파트 정문",
        category_name: "교통,수송 > 입출구",
        y: "37.5",
        x: "127.1",
      },
    ] as never);
    const res = await GET(
      makeRequest(`?name=${encodeURIComponent("신명중학교")}&lat=${DEST.lat}&lng=${DEST.lng}`),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).entrance).toBeNull();
  });

  it("좌표가 없으면 400 — (0,0)으로 위장하지 않는다", async () => {
    const res = await GET(makeRequest(`?name=${encodeURIComponent("신명중학교")}`));
    expect(res.status).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("이름이 없으면 400", async () => {
    expect((await GET(makeRequest(`?lat=${DEST.lat}&lng=${DEST.lng}`))).status).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("출발지 좌표는 선택이다 — 빈 값이어도 400이 아니다", async () => {
    const res = await GET(
      makeRequest(`?name=${encodeURIComponent("신명중학교")}&lat=${DEST.lat}&lng=${DEST.lng}&fromLat=&fromLng=`),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).entrance.name).toBe("신명중학교 정문");
  });

  it("한국 밖이면 커버리지 마커 — upstream을 부르지 않는다", async () => {
    const res = await GET(makeRequest("?name=Eiffel&lat=48.858&lng=2.294"));
    expect(res.status).toBe(200);
    expect((await res.json()).outOfCoverage).toBe(true);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("키가 없으면 404 게이트 — 커버리지 판정보다 뒤다", async () => {
    mockHasKey.mockReturnValue(false);
    const res = await GET(
      makeRequest(`?name=${encodeURIComponent("신명중학교")}&lat=${DEST.lat}&lng=${DEST.lng}`),
    );
    expect(res.status).toBe(404);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("upstream 실패는 502 — 0건으로 위장하지 않는다", async () => {
    mockSearch.mockRejectedValue(new Error("HTTP 500"));
    const res = await GET(
      makeRequest(`?name=${encodeURIComponent("신명중학교")}&lat=${DEST.lat}&lng=${DEST.lng}`),
    );
    expect(res.status).toBe(502);
  });
});
