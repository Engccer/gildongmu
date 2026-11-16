import { afterEach, describe, expect, it, vi } from "vitest";
import { boardStopDeparture, PLATFORM_DWELL_SECONDS } from "../transit-track";

/**
 * A74(spec `2026-11-17-a74-departed-train-at-board-stop-design.md` §3): 조회 역에 「도착」으로 실린 열차가
 * 이미 떠났는가. 시각은 KST 2026-11-17 05:43:07 기준(실측 표본의 6011·6002를 옮겼다).
 */
const NOW = Date.parse("2026-11-17T05:43:07+09:00");
const at = (hms: string) => `2026-11-17 ${hms}`;

describe("boardStopDeparture — 승강장을 떠난 열차 판정(A74)", () => {
  it("위치 피드가 나중 시각에 다른 역을 말하면 떠났다(도착 피드는 아직 「도착」)", () => {
    expect(
      boardStopDeparture({
        station: "복정",
        receivedAt: at("05:40:33"),
        position: { trainNo: "6011", station: "가천대", trainStatus: "0", receivedAt: at("05:43:01") },
        nowMs: NOW,
      }),
    ).toEqual({ departed: true, platformAgeSeconds: 154 });
  });

  it("다른 역을 말하는 위치가 도착 레코드보다 오래됐으면 증거가 아니다(막 도착한 열차 + 낡은 위치 캐시)", () => {
    expect(
      boardStopDeparture({
        station: "복정",
        receivedAt: at("05:42:50"),
        position: { trainNo: "6011", station: "수서", trainStatus: "1", receivedAt: at("05:42:20") },
        nowMs: NOW,
      }),
    ).toEqual({ departed: false, platformAgeSeconds: 17 });
  });

  it("같은 역이라도 위치 상태가 출발(2)이면 떠났다", () => {
    const r = boardStopDeparture({
      station: "교대",
      receivedAt: at("05:42:50"),
      position: { trainNo: "3003", station: "교대(법원.검찰청)", trainStatus: "2", receivedAt: at("05:42:59") },
      nowMs: NOW,
    });
    expect(r.departed).toBe(true);
  });

  it("같은 역·도착(1)이면 두 피드 나이 중 큰 값으로 가른다 — 도착 피드 수신 시각만 새로 찍힌 실사고 모양", () => {
    // 도착 피드 나이 42초(신선해 보인다), 위치 피드 나이 138초(실제 도착 시각).
    const r = boardStopDeparture({
      station: "복정",
      receivedAt: at("05:42:25"),
      position: { trainNo: "6163", station: "복정", trainStatus: "1", receivedAt: at("05:40:49") },
      nowMs: NOW,
    });
    expect(r).toEqual({ departed: true, platformAgeSeconds: 138 });
  });

  it("정차 96초(2호선 교대 실측)는 떠난 것이 아니다 — 문이 열린 열차를 숨기지 않는다", () => {
    const r = boardStopDeparture({
      station: "교대",
      receivedAt: at("05:41:31"),
      position: { trainNo: "3003", station: "교대(법원.검찰청)", trainStatus: "1", receivedAt: at("05:41:31") },
      nowMs: NOW,
    });
    expect(r).toEqual({ departed: false, platformAgeSeconds: 96 });
  });

  it("조회 역 표기가 달라도 같은 레코드의 현재 위치와 같으면 같은 역이다", () => {
    const r = boardStopDeparture({
      station: "남한산성입구",
      currentLocation: "남한산성입구(성남법원.검찰청)",
      receivedAt: at("05:42:33"),
      position: { trainNo: "8008", station: "남한산성입구(성남법원.검찰청)", trainStatus: "1", receivedAt: at("05:42:40") },
      nowMs: NOW,
    });
    expect(r.departed).toBe(false);
  });

  it("상한은 초과일 때만 넘는다", () => {
    const ageExactly = (seconds: number) =>
      boardStopDeparture({
        station: "복정",
        receivedAt: new Date(NOW - seconds * 1000 + 9 * 3600_000).toISOString().slice(0, 19).replace("T", " "),
        position: null,
        nowMs: NOW,
      });
    expect(ageExactly(PLATFORM_DWELL_SECONDS).departed).toBe(false);
    expect(ageExactly(PLATFORM_DWELL_SECONDS + 1).departed).toBe(true);
  });

  it("위치가 없으면 도착 레코드 나이만으로 가르고, 그마저 없으면 떠났다고 하지 않는다", () => {
    expect(boardStopDeparture({ station: "복정", receivedAt: at("05:39:53"), position: null, nowMs: NOW }))
      .toEqual({ departed: true, platformAgeSeconds: 194 });
    expect(boardStopDeparture({ station: "복정", receivedAt: undefined, position: null, nowMs: NOW }))
      .toEqual({ departed: false, platformAgeSeconds: null });
  });

  it("미래 수신 시각(신분당선 고장)은 0초로 읽는다", () => {
    expect(boardStopDeparture({ station: "강남", receivedAt: at("05:48:00"), position: null, nowMs: NOW }))
      .toEqual({ departed: false, platformAgeSeconds: 0 });
  });
});

describe("trackSubway — 떠난 열차 표식과 옛 클라이언트 보호(A74, 모킹)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.doUnmock("../providers/seoul-subway-arrival");
    vi.doUnmock("../providers/seoul-subway-position");
  });

  const arrival = (over: Record<string, unknown>) => ({
    line: "수인분당선", direction: "하행", trainLineNm: "x", destination: "고색",
    message: "복정 도착", arrivalSeconds: 0, express: false, arrivalCode: "1", currentLocation: "복정", ...over,
  });

  async function track(
    arrivals: unknown[],
    positions: (() => Promise<unknown>) | null,
    departCheck = true,
  ) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.resetModules();
    const positionMock = vi.fn(positions ?? (async () => null));
    vi.doMock("../providers/seoul-subway-arrival", () => ({
      fetchSubwayArrivals: vi.fn(async () => ({ stationName: "복정", arrivals })),
      subwayLineNameForId: (id: string) => ({ "1075": "수인분당선" })[id],
    }));
    vi.doMock("../providers/seoul-subway-position", () => ({ fetchSubwayLinePositions: positionMock }));
    const mod = await import("../transit-track");
    const result = await mod.trackSubway({ station: "복정", lineName: "수도권 수인분당선", lang: "ko", departCheck });
    return { result, positionMock };
  }

  it("다음 역에 들어선 열차: 표식을 싣고, 나이가 옛 상한(120초)을 넘으면 dataAgeSeconds가 숫자다", async () => {
    const { result } = await track(
      [arrival({ trainNo: "6011", receivedAt: at("05:40:33") })],
      async () => ({ trains: [{ trainNo: "6011", station: "가천대", trainStatus: "0", receivedAt: at("05:43:01") }], total: 1, truncated: false }),
    );
    if (result.status !== "ok") throw new Error("ok가 아니다");
    expect(result.items[0]).toMatchObject({
      arrivalCode: "1", message: "복정 도착", departedLikely: true, platformAgeSeconds: 154, dataAgeSeconds: 154,
    });
  });

  it("위치가 움직여 떠난 열차가 옛 상한 이하이면 표식만 싣고 dataAgeSeconds를 부풀리지 않는다", async () => {
    const { result } = await track(
      [arrival({ trainNo: "6002", receivedAt: at("05:41:37") })],
      async () => ({ trains: [{ trainNo: "6002", station: "가천대", trainStatus: "0", receivedAt: at("05:43:01") }], total: 1, truncated: false }),
    );
    if (result.status !== "ok") throw new Error("ok가 아니다");
    expect(result.items[0]).toMatchObject({ departedLikely: true, platformAgeSeconds: 90, dataAgeSeconds: 90 });
  });

  it("옵트인이 없으면 위치를 조회하지 않는다(하차역 폴·옛 클라이언트) — 레코드 나이 판정과 스토어판 보호는 그대로", async () => {
    const { result, positionMock } = await track(
      [arrival({ trainNo: "6013", receivedAt: at("05:42:33") }), arrival({ trainNo: "6002", receivedAt: at("05:39:53") })],
      async () => ({ trains: [{ trainNo: "6013", station: "가천대", trainStatus: "0", receivedAt: at("05:43:01") }], total: 1, truncated: false }),
      false,
    );
    expect(positionMock).not.toHaveBeenCalled();
    if (result.status !== "ok") throw new Error("ok가 아니다");
    expect(result.items[0]).not.toHaveProperty("departedLikely");
    expect(result.items[1]).toMatchObject({ departedLikely: true, dataAgeSeconds: 194 });
  });

  it("레코드 나이만으로 이미 갈린 「도착」뿐이면 옵트인이어도 위치를 조회하지 않는다", async () => {
    const { result, positionMock } = await track([arrival({ trainNo: "6002", receivedAt: at("05:39:53") })], null);
    expect(positionMock).not.toHaveBeenCalled();
    if (result.status !== "ok") throw new Error("ok가 아니다");
    expect(result.items[0]).toMatchObject({ departedLikely: true, dataAgeSeconds: 194 });
  });

  it("같은 열차 번호의 위치 행이 둘이면 수신 시각이 새로운 행을 쓴다", async () => {
    const { result } = await track(
      [arrival({ trainNo: "6011", receivedAt: at("05:42:33") })],
      async () => ({
        trains: [
          { trainNo: "6011", station: "가천대", trainStatus: "0", receivedAt: at("05:43:01") },
          { trainNo: "6011", station: "복정", trainStatus: "1", receivedAt: at("05:42:33") },
        ],
        total: 2, truncated: false,
      }),
    );
    if (result.status !== "ok") throw new Error("ok가 아니다");
    expect(result.items[0]).toMatchObject({ departedLikely: true });
  });

  it("방금 도착한 열차는 표식이 없다(필드 부재)", async () => {
    const { result } = await track([arrival({ trainNo: "6013", receivedAt: at("05:42:33") })], null);
    if (result.status !== "ok") throw new Error("ok가 아니다");
    expect(result.items[0]).not.toHaveProperty("departedLikely");
    expect(result.items[0]).toMatchObject({ platformAgeSeconds: 34, dataAgeSeconds: 34 });
  });

  it("위치 조회가 실패해도 추적은 응답하고 도착 레코드 나이로 가른다", async () => {
    const { result, positionMock } = await track(
      [arrival({ trainNo: "6013", receivedAt: at("05:42:33") }), arrival({ trainNo: "6002", receivedAt: at("05:39:53") })],
      async () => { throw new Error("upstream"); },
    );
    expect(positionMock).toHaveBeenCalledTimes(1);
    if (result.status !== "ok") throw new Error("ok가 아니다");
    expect(result.items[0]).not.toHaveProperty("departedLikely");
    expect(result.items[1]).toMatchObject({ departedLikely: true, dataAgeSeconds: 194 });
  });

  it("「도착」 항목이 없으면 위치를 조회하지 않고, 다른 코드 항목은 표식·승강장 나이가 없다", async () => {
    const { result, positionMock } = await track(
      [arrival({ trainNo: "6015", message: "전역 출발", arrivalCode: "3", receivedAt: at("05:39:00") })],
      null,
    );
    expect(positionMock).not.toHaveBeenCalled();
    if (result.status !== "ok") throw new Error("ok가 아니다");
    expect(result.items[0]).not.toHaveProperty("departedLikely");
    expect(result.items[0]).not.toHaveProperty("platformAgeSeconds");
  });
});
