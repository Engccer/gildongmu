import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../env", () => ({ env: { SEOUL_SUBWAY_REALTIME_KEY: "TESTKEY" } }));

import {
  fetchSubwayLinePositions,
  parseSubwayPositions,
  POSITION_CACHE_TTL_MS,
  resetSubwayPositionCache,
} from "../seoul-subway-position";

// 2026-09-23 14:49 KST 5호선 실응답에서 뽑은 행 모양(열 이름·값 형식 그대로).
const ROW = {
  subwayId: "1005", subwayNm: "5호선", statnId: "1005080549", statnNm: "군자(능동)",
  trainNo: "5619", lastRecptnDt: "20260923", recptnDt: "2026-09-23 14:49:24",
  updnLine: "1", statnTid: "1005080555", statnTnm: "마천", trainSttus: "3", directAt: "0", lstcarAt: "0",
};
const OK = { errorMessage: { code: "INFO-000", total: 1 }, realtimePositionList: [ROW] };

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("parseSubwayPositions — swopenapi 봉투 두 형(E35 §2)", () => {
  it("INFO-000(중첩 코드): 열차번호·역명·상태·수신 시각만 싣는다", () => {
    const r = parseSubwayPositions(OK);
    expect(r).toEqual({
      trains: [{ trainNo: "5619", station: "군자(능동)", trainStatus: "3", receivedAt: "2026-09-23 14:49:24" }],
      total: 1,
      truncated: false,
    });
  });

  it("INFO-200(평면 코드)은 0행 — 운행 밖과 미제공을 가르지 않는다", () => {
    expect(parseSubwayPositions({ status: 500, code: "INFO-200", message: "해당하는 데이터가 없습니다." }))
      .toEqual({ trains: [], total: 0, truncated: false });
  });

  it("그 밖의 코드는 throw(일시 장애 ≠ 정보 없음)", () => {
    expect(() => parseSubwayPositions({ status: 500, code: "ERROR-337" })).toThrow(/ERROR-337/);
    expect(() => parseSubwayPositions({})).toThrow(/unknown/);
  });

  it("total이 받은 행보다 크면 truncated", () => {
    const r = parseSubwayPositions({ errorMessage: { code: "INFO-000", total: 36 }, realtimePositionList: [ROW] });
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(36);
  });

  it("열차번호·역명 없는 행은 조인할 수 없어 버린다", () => {
    const r = parseSubwayPositions({
      errorMessage: { code: "INFO-000", total: 2 },
      realtimePositionList: [ROW, { ...ROW, trainNo: "" }],
    });
    expect(r.trains.map((t) => t.trainNo)).toEqual(["5619"]);
    expect(r.truncated).toBe(false);
  });

  it("⚠ updnLine은 소스에서 읽지 않는다(규격과 실측 방향 불일치 — 미사용이 방어)", () => {
    const src = readFileSync(join(__dirname, "../seoul-subway-position.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/updnLine/);
  });
});

describe("fetchSubwayLinePositions — 노선 캐시(E35 §3.1)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetSubwayPositionCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("노선명을 인코딩해 200행 창(0/200)으로 조회한다", async () => {
    fetchMock.mockResolvedValue(okResponse(OK));
    await fetchSubwayLinePositions("5호선", 1_000);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(`http://swopenapi.seoul.go.kr/api/subway/TESTKEY/json/realtimePosition/0/200/${encodeURIComponent("5호선")}`);
  });

  it("TTL 안의 같은 노선은 upstream을 다시 부르지 않고, TTL 뒤에는 부른다", async () => {
    fetchMock.mockResolvedValue(okResponse(OK));
    await fetchSubwayLinePositions("5호선", 1_000);
    await fetchSubwayLinePositions("5호선", 1_000 + POSITION_CACHE_TTL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchSubwayLinePositions("5호선", 1_000 + POSITION_CACHE_TTL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("노선이 다르면 캐시를 공유하지 않는다", async () => {
    fetchMock.mockResolvedValue(okResponse(OK));
    await fetchSubwayLinePositions("5호선", 1_000);
    await fetchSubwayLinePositions("2호선", 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("비행 중 요청은 공유한다", async () => {
    let resolve!: (v: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { resolve = r; }));
    const a = fetchSubwayLinePositions("5호선", 1_000);
    const b = fetchSubwayLinePositions("5호선", 1_000);
    resolve(okResponse(OK));
    expect(await a).toEqual(await b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("실패는 캐시하지 않는다", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await expect(fetchSubwayLinePositions("5호선", 1_000)).rejects.toThrow(/HTTP 500/);
    fetchMock.mockResolvedValueOnce(okResponse(OK));
    const r = await fetchSubwayLinePositions("5호선", 1_001);
    expect(r?.trains).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
