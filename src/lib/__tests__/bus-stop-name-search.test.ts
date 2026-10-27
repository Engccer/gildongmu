// 정류장 이름 검색 provider(E70-e spec §4.6). 응답 모양은 2026-10-27 실호출 관측값이다.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../env", () => ({ env: { DATA_GO_KR_API_KEY: "test-key" } }));

import { searchSeoulStopsByName } from "../providers/seoul-bus";
import { searchTagoStopsByName } from "../providers/tago-bus";

function mockFetchSequence(...payloads: unknown[]) {
  const fn = vi.fn();
  for (const p of payloads) {
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(p) });
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const seoulBody = (itemList: unknown) => ({ msgHeader: { headerCd: "0" }, msgBody: { itemList } });
const tagoBody = (items: unknown[], totalCount: number) => ({
  response: { header: { resultCode: "00" }, body: { items: { item: items }, totalCount } },
});
const tagoItem = (i: number) => ({ gpslati: 35 + i / 100, gpslong: 129.06, nodeid: `N${i}`, nodenm: `정류장${i}`, ...(i % 2 ? { nodeno: String(10000 + i) } : {}) });

describe("searchSeoulStopsByName", () => {
  it("tmX는 경도·tmY는 위도로 읽고 arsId를 stopNo로 싣는다", async () => {
    const fn = mockFetchSequence(
      seoulBody([
        { stId: "101000227", stNm: "시청.덕수궁", tmX: "126.976921", tmY: "37.566254", arsId: "02662" },
        { stId: "1", stNm: "좌표없음", arsId: "0" },
      ]),
    );
    const hits = await searchSeoulStopsByName("덕수궁");
    expect(hits).toEqual([{ name: "시청.덕수궁", lat: 37.566254, lng: 126.976921, stopNo: "02662", source: "seoul" }]);
    const url = new URL(String(fn.mock.calls[0][0]));
    expect(url.pathname).toContain("stationinfo/getStationByName");
    expect(url.searchParams.get("stSrch")).toBe("덕수궁");
  });

  it("headerCd 4(결과 없음)는 빈 배열, 인증 실패(7)는 throw", async () => {
    mockFetchSequence({ msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다" }, msgBody: {} });
    expect(await searchSeoulStopsByName("없는이름")).toEqual([]);
    mockFetchSequence({ msgHeader: { headerCd: "7", headerMsg: "인증실패" } });
    await expect(searchSeoulStopsByName("x")).rejects.toThrow();
  });
});

describe("searchTagoStopsByName", () => {
  it("한 페이지에 totalCount가 다 담기면 truncated 아님, nodeno는 stopNo", async () => {
    const fn = mockFetchSequence(tagoBody([tagoItem(1), tagoItem(2)], 2));
    const r = await searchTagoStopsByName("21", "서면");
    expect(r.truncated).toBe(false);
    expect(r.stops).toEqual([
      { name: "정류장1", lat: 35.01, lng: 129.06, stopNo: "10001", source: "tago" },
      { name: "정류장2", lat: 35.02, lng: 129.06, source: "tago" },
    ]);
    const url = new URL(String(fn.mock.calls[0][0]));
    expect(url.searchParams.get("cityCode")).toBe("21");
    expect(url.searchParams.get("nodeNm")).toBe("서면");
  });

  it("totalCount까지 여러 페이지를 모은다", async () => {
    const page = (from: number, n: number) => tagoBody(Array.from({ length: n }, (_, i) => tagoItem(from + i)), 230);
    const fn = mockFetchSequence(page(0, 100), page(100, 100), page(200, 30));
    const r = await searchTagoStopsByName("21", "서면");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(r.stops).toHaveLength(230);
    expect(r.truncated).toBe(false);
  });

  it("5페이지 상한에 걸려 남았으면 truncated", async () => {
    const page = (from: number) => tagoBody(Array.from({ length: 100 }, (_, i) => tagoItem(from + i)), 800);
    const fn = mockFetchSequence(page(0), page(100), page(200), page(300), page(400), page(500));
    const r = await searchTagoStopsByName("21", "정류");
    expect(fn).toHaveBeenCalledTimes(5);
    expect(r.stops).toHaveLength(500);
    expect(r.truncated).toBe(true);
  });

  it("2페이지부터 병렬로 부르고 중간 페이지 실패는 throw(부분 페이지로 정렬하지 않는다)", async () => {
    const page = (from: number) => tagoBody(Array.from({ length: 100 }, (_, i) => tagoItem(from + i)), 300);
    const fn = vi.fn();
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(page(0)) });
    fn.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" });
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(page(200)) });
    vi.stubGlobal("fetch", fn);
    await expect(searchTagoStopsByName("21", "서면")).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("items.item이 단건 객체로 와도 읽는다", async () => {
    mockFetchSequence({ response: { header: { resultCode: "00" }, body: { items: { item: tagoItem(1) }, totalCount: 1 } } });
    expect((await searchTagoStopsByName("21", "서면")).stops).toHaveLength(1);
  });

  it("빈 결과는 빈 배열", async () => {
    mockFetchSequence(tagoBody([], 0));
    expect(await searchTagoStopsByName("21", "없는이름")).toEqual({ stops: [], truncated: false });
  });
});
