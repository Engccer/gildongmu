import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasDataGoKrKey: vi.fn(() => true),
  hasKakaoKey: vi.fn(() => true),
}));
vi.mock("@/lib/journey/stop-search", () => ({
  stopSearchDeps: {},
  searchJourneyStops: vi.fn(async () => ({ stops: [] })),
}));

import { GET } from "../route";
import { hasKakaoKey } from "@/lib/env";
import { searchJourneyStops } from "@/lib/journey/stop-search";

function req(params: Record<string, string>) {
  return new NextRequest(`http://x/api/route/journey/stops?${new URLSearchParams(params)}`);
}
const SEOUL = "37.5559,126.9723";

describe("GET /api/route/journey/stops", () => {
  beforeEach(() => {
    vi.mocked(hasKakaoKey).mockReturnValue(true);
    vi.mocked(searchJourneyStops).mockReset();
    vi.mocked(searchJourneyStops).mockResolvedValue({ stops: [] });
  });

  it("q가 없거나 한 글자거나 31자면 400", async () => {
    expect((await GET(req({ origin: SEOUL }))).status).toBe(400);
    expect((await GET(req({ q: "가", origin: SEOUL }))).status).toBe(400);
    expect((await GET(req({ q: "가".repeat(31), origin: SEOUL }))).status).toBe(400);
  });

  it("앞뒤 공백을 뗀 뒤 길이를 본다", async () => {
    expect((await GET(req({ q: " 가 ", origin: SEOUL }))).status).toBe(400);
  });

  it("좌표가 하나도 없으면 400, 형식이 틀려도 400(빈 값이 (0,0)으로 위장하지 않는다)", async () => {
    expect((await GET(req({ q: "서면" }))).status).toBe(400);
    expect((await GET(req({ q: "서면", origin: "" }))).status).toBe(400);
  });

  it("좌표가 전부 한국 밖이면 200 outOfCoverage이고 검색하지 않는다", async () => {
    const res = await GET(req({ q: "서면", origin: "35.68,139.76" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(searchJourneyStops).not.toHaveBeenCalled();
  });

  it("한국 밖 좌표는 버리고 안쪽 좌표만으로 검색한다", async () => {
    await GET(req({ q: "서면", origin: "35.68,139.76", dest: SEOUL }));
    expect(vi.mocked(searchJourneyStops).mock.calls[0][1]).toEqual([{ lat: 37.5559, lng: 126.9723 }]);
  });

  it("키가 없으면 503", async () => {
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    expect((await GET(req({ q: "서면", origin: SEOUL }))).status).toBe(503);
  });

  it("정상 응답은 no-store로 그대로 내보낸다(unsearched·failed·truncated 보존)", async () => {
    vi.mocked(searchJourneyStops).mockResolvedValue({ stops: [], unsearched: true, failed: true, truncated: true });
    const res = await GET(req({ q: "서면", origin: SEOUL }));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ stops: [], unsearched: true, failed: true, truncated: true });
  });

  it("검색 전부 실패(throw)는 502", async () => {
    vi.mocked(searchJourneyStops).mockRejectedValue(new Error("x"));
    expect((await GET(req({ q: "서면", origin: SEOUL }))).status).toBe(502);
  });
});
