import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getKakaoWalkBriefing,
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

  it("소수 거리·시간은 정수로 반올림한다(iOS 비옵셔널 Int 디코딩 방어)", () => {
    const res = makeResponse();
    res.route!.properties = { totalDistance: 645.6, totalTime: 644.4 };
    res.route!.legs = [
      { steps: [{ properties: { guidance: "안내", distance: 34.5 }, path: { points: [] } }] },
    ];
    const briefing = normalizeKakaoWalkRoute(res);
    expect(briefing?.distanceMeters).toBe(646);
    expect(briefing?.durationSeconds).toBe(644);
    expect(briefing?.steps[0].distanceMeters).toBe(35);
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

/**
 * 반올림은 캐시 키만 바꾸는 것이 아니라 upstream에 보내는 좌표 자체를 바꾼다.
 * 4자리 격자(≈11m)는 지하철 출입구 두 개를 한 셀에 넣고, 그것이 곧 계단 유무가
 * 갈리는 단위다 — 계단 회피 요청에서만 원좌표를 쓴다(dodo 역이식 2026-08-23).
 */
describe("getKakaoWalkBriefing 좌표 정밀도", () => {
  // 4자리로 반올림하면 둘 다 "37.5135"/"126.9408"이 되는 서로 다른 두 지점(약 7m
  // 떨어져 있다 — 격자 폭이 약 11m라 인접 출입구가 흔히 한 셀에 든다).
  const EXIT_A = { lat: 37.513_501, lng: 126.940_801 };
  const EXIT_B = { lat: 37.513_549, lng: 126.940_849 };

  function stubFetch() {
    const mock = vi.fn(
      async (_url: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify(makeResponse()), { status: 200 }),
    );
    vi.stubGlobal("fetch", mock);
    return mock;
  }
  const urlOf = (m: ReturnType<typeof stubFetch>) => String(m.mock.calls[0]?.[0]);

  afterEach(() => vi.unstubAllGlobals());

  it("기본 요청은 4자리로 반올림한다(캐시 키 안정화 — 종전 계약)", async () => {
    const m = stubFetch();
    await getKakaoWalkBriefing({ origin: EXIT_A, dest: EXIT_B });
    expect(urlOf(m)).toContain("start_x=126.9408");
    expect(urlOf(m)).toContain("end_y=37.5135");
  });

  it("accessible 요청은 원좌표를 보낸다 — 출입구가 합쳐지면 계단 유무가 갈린다", async () => {
    const m = stubFetch();
    await getKakaoWalkBriefing({ origin: EXIT_A, dest: EXIT_B, accessible: true });
    const url = urlOf(m);
    expect(url).toContain("route_mode=ACCESSIBLE");
    expect(url).toContain(`start_x=${EXIT_A.lng}`);
    expect(url).toContain(`start_y=${EXIT_A.lat}`);
    expect(url).toContain(`end_x=${EXIT_B.lng}`);
    expect(url).toContain(`end_y=${EXIT_B.lat}`);
  });

  it("경유지도 같은 축을 따른다(반올림하면 경유 지점이 이웃 출입구로 옮겨간다)", async () => {
    // 경유지 응답은 legs 2개여야 한다(`expectWaypoint` 가드 — 파라미터 이름이 무시되면
    // 200 정상 응답이 오므로 그 가드만이 오타를 잡는다).
    const twoLegs = makeResponse();
    const legs = twoLegs.route!.legs ?? [];
    twoLegs.route!.legs = [...legs, ...legs];
    const m = vi.fn(
      async (_url: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify(twoLegs), { status: 200 }),
    );
    vi.stubGlobal("fetch", m);
    await getKakaoWalkBriefing({
      origin: EXIT_A, dest: EXIT_A, via: EXIT_B, accessible: true,
    });
    expect(urlOf(m)).toContain(`via_x=${EXIT_B.lng}`);
    expect(urlOf(m)).toContain(`via_y=${EXIT_B.lat}`);
  });

  it("두 요청이 같은 셀에서 서로 다른 좌표를 보낸다(반올림이 살아 있으면 동일해진다)", async () => {
    const m1 = stubFetch();
    await getKakaoWalkBriefing({ origin: EXIT_A, dest: EXIT_A, accessible: true });
    const first = urlOf(m1);
    vi.unstubAllGlobals();
    const m2 = stubFetch();
    await getKakaoWalkBriefing({ origin: EXIT_B, dest: EXIT_B, accessible: true });
    expect(urlOf(m2)).not.toBe(first);
  });
});
