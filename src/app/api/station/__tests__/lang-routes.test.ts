import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { StationTimetable, SubwayStationArrivals } from "@/lib/types";

vi.mock("@/lib/env", () => ({
  env: { SEOUL_SUBWAY_REALTIME_KEY: "k", DATA_GO_KR_API_KEY: "k" },
  hasSeoulSubwayRealtimeKey: vi.fn(() => true),
  hasDataGoKrKey: vi.fn(() => true),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkTimetableRateLimit: () => true,
  clientIpFromHeaders: () => "1.1.1.1",
}));
vi.mock("@/lib/providers/tago-subway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/tago-subway")>()),
  fetchStationTimetable: vi.fn(),
}));
vi.mock("@/lib/providers/seoul-subway-arrival", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/seoul-subway-arrival")>()),
  fetchSubwayArrivals: vi.fn(),
}));

import { GET as metaGET } from "../meta/route";
import { GET as timetableGET } from "../timetable/route";
import { GET as arrivalGET } from "../subway-arrival/route";
import { fetchStationTimetable } from "@/lib/providers/tago-subway";
import { fetchSubwayArrivals } from "@/lib/providers/seoul-subway-arrival";

const req = (path: string, q: Record<string, string>) =>
  new NextRequest(`http://x/api/station/${path}?${new URLSearchParams(q)}`);

/**
 * E27 §3.5 — 역 라우트 3종의 `lang`. 미지정·ko는 byte-identical, en은 additive `*En`, 미지 값은 400.
 * 같은 프로세스에서 ko→en→ko로 불러 응답 격리를 본다(설계 리뷰 #9).
 */
describe("GET /api/station/meta — lang", () => {
  it("ko·미지정은 동일 본문이고 linesEn이 없다, en은 linesEn이 붙는다", async () => {
    const ko = await (await metaGET(req("meta", { station: "강남역" }))).json();
    const en = await (await metaGET(req("meta", { station: "강남역", lang: "en" }))).json();
    const ko2 = await (await metaGET(req("meta", { station: "강남역", lang: "ko" }))).json();
    expect(ko.meta.linesEn).toBeUndefined();
    expect(JSON.stringify(ko2)).toBe(JSON.stringify(ko));
    expect(en.meta.lines).toEqual(ko.meta.lines);
    expect(en.meta.linesEn).toEqual(["Line 2", "Shinbundang Line"]);
  });
  it("미지 lang은 400", async () => {
    expect((await metaGET(req("meta", { station: "강남역", lang: "jp" }))).status).toBe(400);
  });
  it("미커버 역은 en에서도 meta:null", async () => {
    const en = await (await metaGET(req("meta", { station: "없는역", lang: "en" }))).json();
    expect(en.meta).toBeNull();
  });
});

describe("GET /api/station/timetable — lang", () => {
  const TT: StationTimetable = {
    stationName: "서울숲",
    dailyType: "weekday",
    lines: [
      { lineName: "수인분당선", lineCore: "수인분당", coverage: "ok", directions: [] },
      { lineName: "화성선", coverage: "unknown", directions: [] },
    ],
  };
  beforeEach(() => {
    vi.mocked(fetchStationTimetable).mockReset();
    vi.mocked(fetchStationTimetable).mockResolvedValue(TT);
  });
  it("en은 표 매핑 노선에만 lineNameEn(미지는 부재), ko는 무변화", async () => {
    const ko = await (await timetableGET(req("timetable", { station: "서울숲" }))).json();
    const en = await (await timetableGET(req("timetable", { station: "서울숲", lang: "en" }))).json();
    expect(ko.timetable).toEqual(TT);
    expect(en.timetable.lines[0].lineNameEn).toBe("Suin-Bundang Line");
    expect(en.timetable.lines[0].lineCore).toBe("수인분당");
    expect(en.timetable.lines[1].lineNameEn).toBeUndefined();
  });
  it("미커버(null)는 en에서도 null", async () => {
    vi.mocked(fetchStationTimetable).mockResolvedValue(null);
    const en = await (await timetableGET(req("timetable", { station: "x", lang: "en" }))).json();
    expect(en.timetable).toBeNull();
  });
});

describe("GET /api/station/subway-arrival — lang", () => {
  const ARR: SubwayStationArrivals = {
    stationName: "강남",
    arrivals: [
      {
        line: "2호선",
        direction: "외선",
        trainLineNm: "성수행 - 역삼방면",
        destination: "성수",
        message: "강남 도착",
        currentLocation: "강남",
        arrivalSeconds: 0,
        express: false,
        arrivalCode: "1",
      },
    ],
  };
  beforeEach(() => {
    vi.mocked(fetchSubwayArrivals).mockReset();
    vi.mocked(fetchSubwayArrivals).mockResolvedValue(ARR);
  });
  it("en은 실 seed로 영문 필드를 만들고 한국어 필드는 그대로, ko는 무변화", async () => {
    const ko = await (await arrivalGET(req("subway-arrival", { station: "강남역" }))).json();
    const en = await (await arrivalGET(req("subway-arrival", { station: "강남역", lang: "en" }))).json();
    expect(ko.arrivals).toEqual(ARR);
    const a = en.arrivals.arrivals[0];
    expect(a.message).toBe("강남 도착");
    expect(a.messageEn).toBe("Arrived at Gangnam");
    expect(a.lineEn).toBe("Line 2");
    expect(a.directionEn).toBe("Outer Circle");
    expect(a.trainLineNmEn).toBe("To Seongsu via Yeoksam");
    expect(a.currentLocationEn).toBe("Gangnam");
    const ko2 = await (await arrivalGET(req("subway-arrival", { station: "강남역", lang: "ko" }))).json();
    expect(JSON.stringify(ko2)).toBe(JSON.stringify(ko));
  });
  it("미커버(null)는 en에서도 arrivals:null", async () => {
    vi.mocked(fetchSubwayArrivals).mockResolvedValue(null);
    const en = await (await arrivalGET(req("subway-arrival", { station: "x", lang: "en" }))).json();
    expect(en.arrivals).toBeNull();
  });
});
