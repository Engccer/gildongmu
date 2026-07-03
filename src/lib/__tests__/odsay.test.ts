import { describe, it, expect, vi, afterEach } from "vitest";
import { getTransitRoute, normalizeOdsayRoute } from "@/lib/providers/odsay";

// ODsay searchPubTransPathT 실응답 발췌 (2026-06-18 강동 길동→강남 실호출로 확정).
// 단위: totalTime/sectionTime=분, payment=원, totalWalk=미터.
// ⚠ 환승 도보는 {trafficType:3, distance:0, sectionTime>0}(역내 통로) — leg 제외, walkMinutes엔 포함.
// 지하철 lane={name}, 버스 lane={busNo}.
const sample = {
  result: {
    searchType: 0,
    outTrafficCheck: 0,
    path: [
      {
        pathType: 1,
        info: {
          totalTime: 33,
          payment: 1650,
          totalWalk: 216,
          busTransitCount: 0,
          subwayTransitCount: 3,
          firstStartStation: "길동",
          lastEndStation: "강남",
        },
        subPath: [
          { trafficType: 3, distance: 210, sectionTime: 3 },
          {
            trafficType: 1,
            distance: 1700,
            sectionTime: 4,
            stationCount: 2,
            startName: "길동",
            endName: "천호",
            lane: [{ name: "수도권 5호선" }],
          },
          { trafficType: 3, distance: 0, sectionTime: 1 }, // 환승 통로
          {
            trafficType: 1,
            distance: 3300,
            sectionTime: 6,
            stationCount: 3,
            startName: "천호",
            endName: "잠실",
            lane: [{ name: "수도권 8호선" }],
          },
          { trafficType: 3, distance: 0, sectionTime: 3 }, // 환승 통로
          {
            trafficType: 1,
            distance: 6700,
            sectionTime: 11,
            stationCount: 6,
            startName: "잠실",
            endName: "강남",
            lane: [{ name: "수도권 2호선" }],
          },
          { trafficType: 3, distance: 6, sectionTime: 1 },
        ],
      },
      {
        pathType: 3,
        info: {
          totalTime: 40,
          payment: 1750,
          totalWalk: 597,
          busTransitCount: 1,
          subwayTransitCount: 1,
          firstStartStation: "길동사거리.강동세무서",
          lastEndStation: "강남",
        },
        subPath: [
          { trafficType: 3, distance: 447, sectionTime: 7 },
          {
            trafficType: 2,
            distance: 4790,
            sectionTime: 19,
            stationCount: 10,
            startName: "길동사거리.강동세무서",
            endName: "잠실역8번출구",
            lane: [{ busNo: "30-3" }],
          },
          { trafficType: 3, distance: 144, sectionTime: 2 },
          {
            trafficType: 1,
            distance: 6700,
            sectionTime: 11,
            stationCount: 6,
            startName: "잠실",
            endName: "강남",
            lane: [{ name: "수도권 2호선" }],
          },
          { trafficType: 3, distance: 6, sectionTime: 1 },
        ],
      },
    ],
  },
};

describe("normalizeOdsayRoute", () => {
  it("path[0]을 추천, 다음을 대안으로 분리한다", () => {
    const result = normalizeOdsayRoute(sample)!;
    expect(result.recommended.summary.totalMinutes).toBe(33);
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0].summary.totalMinutes).toBe(40);
  });

  it("거리 0 환승 도보는 leg에서 제외하고 지하철/도보를 투영한다", () => {
    const { legs } = normalizeOdsayRoute(sample)!.recommended;
    // 환승 통로(distance 0) 2개는 제외, 진입(210m)·도착(6m) 도보는 유지
    expect(legs.map((l) => l.mode)).toEqual([
      "walk",
      "subway",
      "subway",
      "subway",
      "walk",
    ]);
    expect(legs[1]).toMatchObject({
      mode: "subway",
      lineName: "수도권 5호선",
      fromName: "길동",
      toName: "천호",
      stationCount: 2,
      minutes: 4,
    });
  });

  it("버스 leg는 lane.busNo를 lineName으로 투영한다", () => {
    const alt = normalizeOdsayRoute(sample)!.alternatives[0];
    const bus = alt.legs.find((l) => l.mode === "bus");
    expect(bus).toMatchObject({
      lineName: "30-3",
      fromName: "길동사거리.강동세무서",
      stationCount: 10,
      minutes: 19,
    });
  });

  it("환승 = 탑승 leg 수 - 1, 도보시간은 환승 통로 포함 전체 합", () => {
    const { summary } = normalizeOdsayRoute(sample)!.recommended;
    expect(summary.transfers).toBe(2); // 지하철 3 - 1
    expect(summary.walkMinutes).toBe(8); // 3 + 1(환승) + 3(환승) + 1
    expect(summary.fare).toBe(1650);
    expect(summary.departName).toBe("길동");
    expect(summary.arriveName).toBe("강남");
  });

  it("버스 1 + 지하철 1 경로의 환승은 1", () => {
    const { summary } = normalizeOdsayRoute(sample)!.alternatives[0];
    expect(summary.transfers).toBe(1);
  });

  it("경로가 없으면 null", () => {
    expect(normalizeOdsayRoute({ result: { path: [] } })).toBeNull();
    expect(normalizeOdsayRoute({ result: {} })).toBeNull();
  });

  it("출·도착 700m 이내(error -98)는 경로 없음으로 null(graceful)", () => {
    expect(
      normalizeOdsayRoute({
        error: { code: "-98", msg: "출, 도착지가 700m이내입니다." },
      }),
    ).toBeNull();
  });

  it("그 외 ODsay 오류(파라미터·인증·서버)는 throw", () => {
    expect(() =>
      normalizeOdsayRoute({ error: { code: "500", msg: "잘못된 파라미터입니다." } }),
    ).toThrow("ODsay 길찾기 오류");
  });
});

describe("getTransitRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Vercel 가변 IP 대응: ODsay URI(도메인) 식별은 서버 fetch가 보내는 Referer가 정본.
  // 이 헤더가 빠지면 프로덕션에서 키인증오류로 회귀한다.
  it("서버 fetch에 URI 식별용 Referer 헤더를 보낸다", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(sample)));
    await getTransitRoute({
      origin: { lat: 37.5385, lng: 127.1368 },
      dest: { lat: 37.4979, lng: 127.0276 },
    });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      Referer: "https://gildongmu.vercel.app/",
    });
  });
});
