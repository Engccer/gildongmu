import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasSeoulOpenDataKey: vi.fn(() => true),
}));
vi.mock("@/lib/congestion", () => ({
  findCongestionNear: vi.fn(),
}));

import { GET } from "../route";
import { hasSeoulOpenDataKey } from "@/lib/env";
import { findCongestionNear } from "@/lib/congestion";

const mockHasKey = vi.mocked(hasSeoulOpenDataKey);
const mockFind = vi.mocked(findCongestionNear);

const READING = {
  code: "POI014",
  name: "강남역",
  level: "붐빔",
  message: "사람들이 몰려있을 가능성이 매우 크고…",
  asOf: "2026-08-01 13:40",
  forecast: [{ time: "2026-08-01 15:00", level: "약간 붐빔" }],
};

/** IP를 매 테스트 바꿔 레이트리밋 상태가 테스트 간에 새지 않게 한다. */
let ipSeq = 0;
function makeRequest(query: string) {
  ipSeq += 1;
  return new NextRequest(`http://x/api/congestion/nearby${query}`, {
    headers: { "x-forwarded-for": `10.0.0.${ipSeq % 250}` },
  });
}

describe("GET /api/congestion/nearby", () => {
  beforeEach(() => {
    mockHasKey.mockReset();
    mockHasKey.mockReturnValue(true);
    mockFind.mockReset();
    mockFind.mockResolvedValue({ area: READING } as never);
  });

  it("영역 안 → 등급어·문장·기준시각", async () => {
    const res = await GET(makeRequest("?lat=37.4979&lng=127.0276"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.area.name).toBe("강남역");
    expect(body.area.level).toBe("붐빔");
    expect(body.area.asOf).toBe("2026-08-01 13:40");
  });

  it("예보는 응답에 싣지 않는다(UI 미표기라 보낼 이유가 없다)", async () => {
    const body = await (await GET(makeRequest("?lat=37.4979&lng=127.0276"))).json();
    expect(body.area.forecast).toBeUndefined();
  });

  it("영역 밖 → { area: null } (오류 아님 — 서울의 91%)", async () => {
    mockFind.mockResolvedValue({ area: null } as never);
    const res = await GET(makeRequest("?lat=37.538&lng=127.142")); // 길동
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ area: null });
  });

  it("좌표 결측 → 400 (outOfCoverage로 위장되지 않는다)", async () => {
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("빈 문자열 좌표도 400 (Number('')===0 함정)", async () => {
    expect((await GET(makeRequest("?lat=&lng="))).status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("전지구 범위 밖 → 400", async () => {
    expect((await GET(makeRequest("?lat=91&lng=127"))).status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("국외 좌표 → outOfCoverage, 키 게이트보다 앞(upstream 미호출)", async () => {
    mockHasKey.mockReturnValue(false); // 게이트가 뒤라는 것을 증명
    const res = await GET(makeRequest("?lat=35.68&lng=139.69")); // 도쿄
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("키 없음 → { area: null }(이중 방어), upstream 미호출", async () => {
    mockHasKey.mockReturnValue(false);
    const res = await GET(makeRequest("?lat=37.4979&lng=127.0276"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ area: null });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("upstream 장애 → 502 (조회 실패와 '핫스팟 아님'을 구분)", async () => {
    mockFind.mockRejectedValue(new Error("citydata_ppltn ERROR-500"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(makeRequest("?lat=37.4979&lng=127.0276"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBeTruthy();
  });

  it("레이트리밋 초과 → 429", async () => {
    const req = () =>
      new NextRequest("http://x/api/congestion/nearby?lat=37.4979&lng=127.0276", {
        headers: { "x-forwarded-for": "198.51.100.7" },
      });
    for (let i = 0; i < 10; i += 1) {
      expect((await GET(req())).status).toBe(200);
    }
    expect((await GET(req())).status).toBe(429);
  });
});
