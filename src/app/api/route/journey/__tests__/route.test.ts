import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasOdsayKey: vi.fn(() => true),
  hasTmapKey: vi.fn(() => true),
  hasKakaoKey: vi.fn(() => true),
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIpFromHeaders: vi.fn(() => "1.2.3.4"),
  reserveJourneyTmap: vi.fn(() => "ok"),
  journeyTmapExhausted: vi.fn(() => false),
}));
vi.mock("@/lib/journey/assemble", () => ({
  journeyDeps: {},
  getJourney: vi.fn(async () => ({ kind: "ok", result: { variants: [] } })),
}));

import { GET } from "../route";
import { hasTmapKey } from "@/lib/env";
import { getJourney } from "@/lib/journey/assemble";
import { journeyTmapExhausted } from "@/lib/rate-limit";

const BASE = { origin: "37.5559,126.9723", dest: "37.5716,126.9764" };

function req(extra: Record<string, string>) {
  return new NextRequest(`http://x/api/route/journey?${new URLSearchParams({ ...BASE, ...extra })}`);
}

describe("GET /api/route/journey", () => {
  beforeEach(() => {
    vi.mocked(hasTmapKey).mockReturnValue(true);
    vi.mocked(getJourney).mockReset();
    vi.mocked(getJourney).mockResolvedValue({ kind: "ok", result: { variants: [] } });
  });

  it("역이 하나도 없으면 400", async () => {
    expect((await GET(req({}))).status).toBe(400);
  });

  it("역 좌표만 있고 이름이 없으면 400", async () => {
    expect((await GET(req({ board: "37.5574,126.9561" }))).status).toBe(400);
  });

  it("lang이 ko가 아니면 400(ko 전용, D2)", async () => {
    const res = await GET(req({ board: "37.5574,126.9561", boardName: "아현역", lang: "en" }));
    expect(res.status).toBe(400);
  });

  it("한국 밖 좌표는 200 outOfCoverage이고 조회하지 않는다", async () => {
    const res = await GET(req({ alight: "33.59,130.42", alightName: "하카타역" }));
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(getJourney).not.toHaveBeenCalled();
  });

  it("키가 없으면 503", async () => {
    vi.mocked(hasTmapKey).mockReturnValue(false);
    expect((await GET(req({ board: "37.5574,126.9561", boardName: "아현역" }))).status).toBe(503);
  });

  it("역 입력을 이름·좌표·노선으로 넘기고 200 no-store로 응답한다", async () => {
    const res = await GET(
      req({ board: "37.5574,126.9561", boardName: "아현역", boardLine: "수도권2호선", alight: "37.5716,126.9764", alightName: "광화문역" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(vi.mocked(getJourney).mock.calls[0][0]).toEqual({
      from: { lat: 37.5559, lng: 126.9723 },
      to: { lat: 37.5716, lng: 126.9764 },
      board: { name: "아현역", coord: { lat: 37.5574, lng: 126.9561 }, line: "수도권2호선" },
      alight: { name: "광화문역", coord: { lat: 37.5716, lng: 126.9764 } },
    });
  });

  it("예약 거절은 429, 일 상한은 503 budgetExhausted", async () => {
    vi.mocked(getJourney).mockResolvedValueOnce({ kind: "rateLimited" });
    expect((await GET(req({ board: "37.5574,126.9561", boardName: "아현역" }))).status).toBe(429);
    vi.mocked(getJourney).mockResolvedValueOnce({ kind: "budgetExhausted" });
    const res = await GET(req({ board: "37.5574,126.9561", boardName: "아현역" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ budgetExhausted: true });
  });

  it("빈 노선 힌트는 부재로 접는다(400 아님)", async () => {
    const res = await GET(req({ board: "37.5574,126.9561", boardName: "아현역", boardLine: " " }));
    expect(res.status).toBe(200);
    expect(vi.mocked(getJourney).mock.calls[0][0].board).toEqual({ name: "아현역", coord: { lat: 37.5574, lng: 126.9561 } });
  });

  it("일 상한이 이미 소진됐으면 조회(ODsay·카카오) 전에 503 budgetExhausted", async () => {
    vi.mocked(journeyTmapExhausted).mockReturnValueOnce(true);
    const res = await GET(req({ board: "37.5574,126.9561", boardName: "아현역" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ budgetExhausted: true });
    expect(getJourney).not.toHaveBeenCalled();
  });

  it("조회 throw는 502", async () => {
    vi.mocked(getJourney).mockRejectedValueOnce(new Error("ODsay 오류"));
    expect((await GET(req({ board: "37.5574,126.9561", boardName: "아현역" }))).status).toBe(502);
  });
});
