import { describe, expect, it } from "vitest";
import {
  normalizeKakaoWalkRoute,
  type KakaoWalkResponse,
} from "../kakao-walk";

function makeResponse(overrides?: Partial<KakaoWalkResponse>): KakaoWalkResponse {
  return {
    status: "OK",
    route: {
      properties: { totalDistance: 646, totalTime: 645 },
      legs: [
        {
          steps: [
            {
              properties: { guidance: "노량진역 7번 출구까지 역사 내 이동", distance: 35 },
              path: { points: [[126.94089, 37.51358], [126.94013, 37.51354]] },
            },
            {
              properties: { guidance: "지하보도 이용", distance: 40 },
              path: { points: [[126.93985, 37.51339]] },
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe("normalizeKakaoWalkRoute", () => {
  it("정상 응답을 WalkRouteBriefing으로 정규화한다(pathCoords lat/lng 변환 포함)", () => {
    const briefing = normalizeKakaoWalkRoute(makeResponse());
    expect(briefing).not.toBeNull();
    expect(briefing?.distanceMeters).toBe(646);
    expect(briefing?.durationSeconds).toBe(645);
    expect(briefing?.steps).toHaveLength(2);
    expect(briefing?.steps[0]).toEqual({
      description: "노량진역 7번 출구까지 역사 내 이동",
      distanceMeters: 35,
      pathCoords: [
        { lat: 37.51358, lng: 126.94089 },
        { lat: 37.51354, lng: 126.94013 },
      ],
    });
  });

  it("다중 leg를 순서대로 평탄화한다", () => {
    const res = makeResponse();
    res.route!.legs = [
      { steps: [{ properties: { guidance: "1구간" }, path: { points: [[127, 37]] } }] },
      { steps: [{ properties: { guidance: "2구간" }, path: { points: [[127.1, 37.1]] } }] },
    ];
    const briefing = normalizeKakaoWalkRoute(res);
    expect(briefing?.steps.map((s) => s.description)).toEqual(["1구간", "2구간"]);
  });

  it("guidance 없는 스텝은 제외하고, 좌표 깨진 스텝은 pathCoords만 생략한다", () => {
    const res = makeResponse();
    res.route!.legs = [
      {
        steps: [
          { properties: { guidance: "" }, path: { points: [[127, 37]] } },
          { properties: { guidance: "좌표 없는 안내" }, path: { points: [] } },
        ],
      },
    ];
    const briefing = normalizeKakaoWalkRoute(res);
    expect(briefing?.steps).toEqual([{ description: "좌표 없는 안내" }]);
  });

  it("경로 불가 status 2종은 null(graceful)", () => {
    for (const status of ["TOO_FAR_AWAY", "ROUTE_RESULT_NOT_FOUND"]) {
      expect(
        normalizeKakaoWalkRoute(makeResponse({ status, route: { properties: { totalDistance: 0, totalTime: 0 }, legs: [] } })),
      ).toBeNull();
    }
  });

  it("미관측 status는 throw(fail-closed — 장애를 경로 없음으로 뭉개지 않는다)", () => {
    expect(() =>
      normalizeKakaoWalkRoute(makeResponse({ status: "UNKNOWN_NEW_STATUS", route: { properties: { totalDistance: 0, totalTime: 0 }, legs: [] } })),
    ).toThrow();
  });

  it("스키마 위반(route 부재·총거리 비유한·안내 단계 0개)은 throw", () => {
    expect(() => normalizeKakaoWalkRoute({ status: "OK" } as KakaoWalkResponse)).toThrow();
    const badDist = makeResponse();
    badDist.route!.properties.totalDistance = 0;
    expect(() => normalizeKakaoWalkRoute(badDist)).toThrow();
    const noSteps = makeResponse();
    noSteps.route!.legs = [{ steps: [{ properties: { guidance: "" }, path: { points: [] } }] }];
    expect(() => normalizeKakaoWalkRoute(noSteps)).toThrow();
  });
});
