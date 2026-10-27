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
  journeyIpExhausted: vi.fn(() => false),
}));
vi.mock("@/lib/journey/assemble", () => ({
  journeyDeps: {},
  getJourney: vi.fn(async () => ({ kind: "ok", result: { variants: [] } })),
}));

import { GET } from "../route";
import { hasTmapKey } from "@/lib/env";
import { getJourney } from "@/lib/journey/assemble";
import { journeyIpExhausted, journeyTmapExhausted } from "@/lib/rate-limit";

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

  it("IP 버킷이 이미 찼으면 조회 전에 429", async () => {
    vi.mocked(journeyIpExhausted).mockReturnValueOnce(true);
    expect((await GET(req({ board: "37.5574,126.9561", boardName: "아현역" }))).status).toBe(429);
    expect(getJourney).not.toHaveBeenCalled();
  });

  it("조회 throw는 502", async () => {
    vi.mocked(getJourney).mockRejectedValueOnce(new Error("ODsay 오류"));
    expect((await GET(req({ board: "37.5574,126.9561", boardName: "아현역" }))).status).toBe(502);
  });

  describe("E70-e stops · boardKind · alightKind", () => {
    const STOP = { board: "37.5574,126.9561", boardName: "시청.교육청" };

    it("stops 없이 boardKind·alightKind가 오면 400", async () => {
      expect((await GET(req({ ...STOP, boardKind: "stop" }))).status).toBe(400);
    });

    it("그 쪽 좌표가 없는 kind는 400", async () => {
      expect((await GET(req({ ...STOP, stops: "1", alightKind: "stop" }))).status).toBe(400);
    });

    it("stops·kind 값이 규격 밖이면 400", async () => {
      expect((await GET(req({ ...STOP, stops: "2" }))).status).toBe(400);
      expect((await GET(req({ ...STOP, stops: "1", boardKind: "bus" }))).status).toBe(400);
    });

    it("stops=1과 boardKind=stop은 서비스에 stops·kind로 전달된다", async () => {
      const res = await GET(req({ ...STOP, stops: "1", boardKind: "stop" }));
      expect(res.status).toBe(200);
      const arg = vi.mocked(getJourney).mock.calls[0][0];
      expect(arg.stops).toBe(true);
      expect(arg.board?.kind).toBe("stop");
    });

    it("옵트인이 없으면 서비스 요청에 stops·kind 키가 없다(종전과 동일)", async () => {
      await GET(req({ ...STOP }));
      const arg = vi.mocked(getJourney).mock.calls[0][0];
      expect(arg).not.toHaveProperty("stops");
      expect(arg.board).not.toHaveProperty("kind");
    });
  });

  describe("E71 boardKind=aboard · boardDir", () => {
    const ABOARD = { board: "37.5547,126.9707", boardName: "서울역", boardLine: "1호선", boardKind: "aboard", boardDir: "상행" };

    it("정상 aboard 요청은 stops 없이도 받고 direction·kind를 board에 실어 넘긴다", async () => {
      const res = await GET(req(ABOARD));
      expect(res.status).toBe(200);
      const arg = vi.mocked(getJourney).mock.calls[0][0];
      expect(arg.board).toEqual({ name: "서울역", coord: { lat: 37.5547, lng: 126.9707 }, line: "1호선", kind: "aboard", direction: "상행" });
      expect(arg).not.toHaveProperty("stops");
    });

    it("방향 네 표기를 모두 받는다", async () => {
      for (const dir of ["상행", "하행", "내선", "외선"]) {
        vi.mocked(getJourney).mockClear();
        expect((await GET(req({ ...ABOARD, boardDir: dir }))).status).toBe(200);
        expect(vi.mocked(getJourney).mock.calls[0][0].board?.direction).toBe(dir);
      }
    });

    it("aboard인데 boardDir가 없으면 400", async () => {
      const { boardDir: _omit, ...rest } = ABOARD;
      expect((await GET(req(rest))).status).toBe(400);
    });

    it("boardDir가 규격 밖이면 400", async () => {
      expect((await GET(req({ ...ABOARD, boardDir: "북행" }))).status).toBe(400);
    });

    it("boardKind 없이 boardDir만 오면 400", async () => {
      const { boardKind: _omit, ...rest } = ABOARD;
      expect((await GET(req(rest))).status).toBe(400);
    });

    it("boardKind=stop과 boardDir를 함께 보내면 400", async () => {
      expect((await GET(req({ ...ABOARD, boardKind: "stop", stops: "1" }))).status).toBe(400);
    });

    it("aboard인데 boardLine이 없거나 공백이면 400", async () => {
      const { boardLine: _omit, ...rest } = ABOARD;
      expect((await GET(req(rest))).status).toBe(400);
      expect((await GET(req({ ...ABOARD, boardLine: " " }))).status).toBe(400);
    });

    it("그 쪽 좌표가 없는 boardKind=aboard는 400", async () => {
      expect((await GET(req({ alight: "37.5716,126.9764", alightName: "광화문역", boardKind: "aboard", boardDir: "상행", boardLine: "1호선" }))).status).toBe(400);
    });

    it("alightKind=aboard는 받지 않는다(400)", async () => {
      expect((await GET(req({ ...ABOARD, alight: "37.5716,126.9764", alightName: "광화문역", alightKind: "aboard" }))).status).toBe(400);
    });

    it("aboard에 역 B를 함께 보내면 alight가 그대로 전달된다", async () => {
      await GET(req({ ...ABOARD, alight: "37.5716,126.9764", alightName: "광화문역" }));
      const arg = vi.mocked(getJourney).mock.calls[0][0];
      expect(arg.board?.kind).toBe("aboard");
      expect(arg.alight).toEqual({ name: "광화문역", coord: { lat: 37.5716, lng: 126.9764 } });
    });
  });
});
