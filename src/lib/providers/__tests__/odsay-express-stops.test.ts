import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 급행 정차역 조회·캐시·쿨다운(spec §3.3·§8, 설계 리뷰 #5·#7·#8·#15).
 * `unstable_cache`는 통과 스텁 — "캐시 함수는 성공만 반환하고 실패는 throw"라는 계약이 캐시 유무와
 * 무관하게 성립해야 한다(부재를 굳히는 경로가 캐시 안에 없다).
 */
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));
vi.mock("../../env", () => ({ env: { ODSAY_API_KEY: "k" } }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { EXPRESS_LINES } from "../../express-stops";
import {
  ExpressStopsError,
  fetchExpressStopsMap,
  fetchExpressStopsUncached,
  resetExpressStopsState,
} from "../odsay-express-stops";

const LINE9 = EXPRESS_LINES.find((e) => e.line === "수도권 9호선")!;
const EXPRESS_16: Array<[number, string]> = [
  [902, "김포공항"], [905, "마곡나루"], [907, "가양"], [910, "염창"], [913, "당산"], [915, "여의도"],
  [917, "노량진"], [920, "동작"], [923, "고속터미널"], [925, "신논현"], [927, "선정릉"], [929, "봉은사"],
  [930, "종합운동장"], [933, "석촌"], [936, "올림픽공원"], [938, "중앙보훈병원"],
];
const NAMES_16 = EXPRESS_16.map(([, n]) => n);
const leg = (start: string, end: string, rows: Array<[number, string]>) => ({
  trafficType: 1,
  startName: start,
  endName: end,
  lane: [{ name: LINE9.expressLane }],
  passStopList: { stations: rows.map(([stationID, stationName]) => ({ stationID, stationName })) },
});
const FORWARD = { result: { path: [{ subPath: [leg("김포공항", "중앙보훈병원", EXPRESS_16)] }] } };
const REVERSE = { result: { path: [{ subPath: [leg("중앙보훈병원", "김포공항", [...EXPRESS_16].reverse())] }] } };

/** URL의 SX로 방향을 가른다(정방향 SX=개화 경도 126.7969). */
function respondByDirection(forward: unknown, reverse: unknown) {
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (url.includes("SX=126.7969") ? forward : reverse),
  }));
}

/** ⚠ 화살표 한 줄로 쓰면 mock 자체가 반환되어 teardown으로 등록된다(중괄호 필수) */
beforeEach(() => {
  fetchMock.mockReset();
  resetExpressStopsState();
});

describe("fetchExpressStopsUncached", () => {
  it("정·역방향 2콜로 조회해 집합을 돌려준다(SearchPathType=1, no-store, 타임아웃)", async () => {
    respondByDirection(FORWARD, REVERSE);
    await expect(fetchExpressStopsUncached(LINE9)).resolves.toEqual(NAMES_16);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("SearchPathType=1");
    expect(url).toContain("&apiKey=k");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("수락 판정 부재는 rejected로 throw — null을 돌려주는 경로가 없다", async () => {
    respondByDirection(FORWARD, { result: { path: [] } });
    await expect(fetchExpressStopsUncached(LINE9)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("ODsay 봉투 오류는 rejected, 429는 quota, HTTP 실패는 transient", async () => {
    respondByDirection({ error: [{ code: "500", message: "ApiKeyAuthFailed" }] }, REVERSE);
    await expect(fetchExpressStopsUncached(LINE9)).rejects.toMatchObject({ kind: "rejected" });
    respondByDirection({ error: { code: "429", msg: "quota" } }, REVERSE);
    await expect(fetchExpressStopsUncached(LINE9)).rejects.toMatchObject({ kind: "quota" });
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "" });
    await expect(fetchExpressStopsUncached(LINE9)).rejects.toMatchObject({ kind: "transient" });
    fetchMock.mockRejectedValue(new Error("TimeoutError"));
    const e = await fetchExpressStopsUncached(LINE9).catch((x) => x);
    expect(e).toBeInstanceOf(ExpressStopsError);
    expect(e.kind).toBe("transient");
  });
});

describe("fetchExpressStopsMap — 캐시 바깥의 단일 실행·쿨다운", () => {
  it("성공하면 Map에 싣고, 동시 요청은 probe 1세트(2콜)만 쓴다", async () => {
    respondByDirection(FORWARD, REVERSE);
    const [a, b] = await Promise.all([fetchExpressStopsMap([LINE9]), fetchExpressStopsMap([LINE9])]);
    expect(a.get(LINE9.line)).toEqual(NAMES_16);
    expect(b.get(LINE9.line)).toEqual(NAMES_16);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("실패하면 그 노선만 부재이고 throw하지 않는다", async () => {
    respondByDirection(FORWARD, { result: { path: [] } });
    const map = await fetchExpressStopsMap([LINE9]);
    expect(map.has(LINE9.line)).toBe(false);
  });

  it("수락 판정 부재 뒤 6시간 안에는 재조회하지 않고, 지나면 다시 부른다", async () => {
    let t = 1_000_000;
    const now = () => t;
    respondByDirection(FORWARD, { result: { path: [] } });
    await fetchExpressStopsMap([LINE9], now);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    t += 5 * 60 * 60 * 1000; // 5시간
    await fetchExpressStopsMap([LINE9], now);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 창 안 — 0콜
    t += 2 * 60 * 60 * 1000; // 7시간
    respondByDirection(FORWARD, REVERSE);
    const map = await fetchExpressStopsMap([LINE9], now);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(map.get(LINE9.line)).toEqual(NAMES_16);
  });

  it("일시 실패(HTTP)는 10분, 429는 1시간 쿨다운", async () => {
    let t = 0;
    const now = () => t;
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "" });
    await fetchExpressStopsMap([LINE9], now);
    const afterFirst = fetchMock.mock.calls.length;
    t += 9 * 60 * 1000;
    await fetchExpressStopsMap([LINE9], now);
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
    t += 2 * 60 * 1000; // 11분
    respondByDirection({ error: { code: "429", msg: "quota" } }, REVERSE);
    await fetchExpressStopsMap([LINE9], now);
    const afterQuota = fetchMock.mock.calls.length;
    expect(afterQuota).toBeGreaterThan(afterFirst);
    t += 50 * 60 * 1000;
    await fetchExpressStopsMap([LINE9], now);
    expect(fetchMock.mock.calls.length).toBe(afterQuota); // 1시간 창 안
    t += 11 * 60 * 1000;
    respondByDirection(FORWARD, REVERSE);
    await fetchExpressStopsMap([LINE9], now);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterQuota);
  });

  it("표가 비면 호출 0", async () => {
    const map = await fetchExpressStopsMap([]);
    expect(map.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
