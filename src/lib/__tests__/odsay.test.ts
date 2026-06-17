import { describe, it, expect } from "vitest";
import { normalizeOdsayRoute } from "@/lib/providers/odsay";

// ODsay searchPubTransPathT 응답(문서 기반, Task 8에서 실응답 교정).
// 단위: totalTime/sectionTime=분, payment=원, totalWalk=미터.
const sample = {
  result: {
    searchType: 0,
    outTrafficCheck: 0,
    path: [
      {
        pathType: 3,
        info: {
          totalTime: 35,
          payment: 1500,
          totalWalk: 480,
          firstStartStation: "길동",
          lastEndStation: "강남",
        },
        subPath: [
          { trafficType: 3, distance: 350, sectionTime: 5 },
          {
            trafficType: 1,
            distance: 4000,
            sectionTime: 8,
            stationCount: 3,
            startName: "길동",
            endName: "천호",
            lane: [{ name: "수도권 5호선" }],
          },
          {
            trafficType: 2,
            distance: 3000,
            sectionTime: 12,
            stationCount: 5,
            startName: "천호역",
            endName: "강남역",
            lane: [{ busNo: "341" }],
          },
          { trafficType: 3, distance: 130, sectionTime: 3 },
          // 거리/시간 0 도보 — skip 대상
          { trafficType: 3, distance: 0, sectionTime: 0 },
        ],
      },
      {
        pathType: 1,
        info: { totalTime: 40, payment: 1400, totalWalk: 600 },
        subPath: [
          { trafficType: 3, distance: 600, sectionTime: 9 },
          {
            trafficType: 1,
            distance: 9000,
            sectionTime: 28,
            stationCount: 9,
            startName: "길동",
            endName: "강남",
            lane: [{ name: "수도권 2호선" }],
          },
        ],
      },
    ],
  },
};

describe("normalizeOdsayRoute", () => {
  it("path[0]을 추천, 다음을 대안으로 분리한다", () => {
    const result = normalizeOdsayRoute(sample)!;
    expect(result.recommended.summary.totalMinutes).toBe(35);
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0].summary.totalMinutes).toBe(40);
  });

  it("subPath를 도보/지하철/버스 leg로 투영하고 0거리 도보를 skip한다", () => {
    const { legs } = normalizeOdsayRoute(sample)!.recommended;
    expect(legs.map((l) => l.mode)).toEqual(["walk", "subway", "bus", "walk"]);
    expect(legs[1]).toMatchObject({
      mode: "subway",
      lineName: "수도권 5호선",
      fromName: "길동",
      toName: "천호",
      stationCount: 3,
      minutes: 8,
    });
    expect(legs[2]).toMatchObject({ mode: "bus", lineName: "341", minutes: 12 });
  });

  it("환승 횟수 = 탑승 leg 수 - 1, 도보시간은 도보 leg 합", () => {
    const { summary } = normalizeOdsayRoute(sample)!.recommended;
    expect(summary.transfers).toBe(1); // 지하철1 + 버스1 - 1
    expect(summary.walkMinutes).toBe(8); // 5 + 3 (0 도보 제외)
    expect(summary.fare).toBe(1500);
    expect(summary.departName).toBe("길동");
    expect(summary.arriveName).toBe("강남");
  });

  it("단일 수단(환승 0) 경로의 환승은 0", () => {
    const { summary } = normalizeOdsayRoute(sample)!.alternatives[0];
    expect(summary.transfers).toBe(0);
  });

  it("경로가 없으면 null", () => {
    expect(normalizeOdsayRoute({ result: { path: [] } })).toBeNull();
    expect(normalizeOdsayRoute({ result: {} })).toBeNull();
  });
});
