import { describe, it, expect } from "vitest";
import { buildGuideRoute } from "../route-geometry";
import {
  advanceProgressAnchor,
  computeFinalApproach,
  presumedArrivalStep,
  relativeDirection,
  PRESUMED_ARRIVAL_CAR,
  PRESUMED_ARRIVAL_WALK,
  type PresumedArrivalInput,
  type PresumedArrivalThresholds,
} from "../final-approach";
import fixtures from "./fixtures/final-approach-scenarios.json";
import presumedFixture from "./fixtures/presumed-arrival-scenarios.json";

/** 남→북 직선 100m 경로. lat 1도 ≈ 111320m. */
const northRoute = () =>
  buildGuideRoute([
    {
      description: "직진",
      pathCoords: [
        { lat: 37.5, lng: 127.1 },
        { lat: 37.5 + 100 / 111320, lng: 127.1 },
      ],
    },
  ])!;

const eastOf = (lat: number, lng: number, meters: number) => ({
  lat,
  lng: lng + meters / (111320 * Math.cos((lat * Math.PI) / 180)),
});

describe("computeFinalApproach", () => {
  it("북쪽으로 걸어와 동쪽 30m에 있는 목적지는 오른쪽", () => {
    const route = northRoute();
    const end = route.polyline.points[route.polyline.points.length - 1];
    const out = computeFinalApproach(route, eastOf(end.lat, end.lng, 30));
    expect(out).not.toBeNull();
    expect(out!.offsetMeters).toBeCloseTo(30, 0);
    expect(out!.relativeBearing).toBeCloseTo(90, 0);
    expect(relativeDirection(out!.relativeBearing!)).toBe("right");
  });

  it("오프셋이 하한 미만이면 방향을 주장하지 않는다", () => {
    const route = northRoute();
    const end = route.polyline.points[route.polyline.points.length - 1];
    const out = computeFinalApproach(route, eastOf(end.lat, end.lng, 4));
    expect(out!.relativeBearing).toBeUndefined();
    expect(out!.bearingUnavailable).toBe("tooClose");
  });

  it("왕복 경로에서 각도를 산술 평균하지 않는다(+179/-179가 0°로 뒤집히지 않는다)", () => {
    // 북 7.5m 뒤 남 7.5m로 되돌아오는 경로(총 15m = 창 전체): 벡터 합이 0에 수렴한다.
    // 각도를 산술 평균하면 (0+180)/2 = 90°가 되어 "동쪽"이라는 거짓 방위가 선다.
    const route = buildGuideRoute([
      {
        description: "왕복",
        pathCoords: [
          { lat: 37.5, lng: 127.1 },
          { lat: 37.5 + 7.5 / 111320, lng: 127.1 },
          { lat: 37.5, lng: 127.1 },
        ],
      },
    ])!;
    const out = computeFinalApproach(route, eastOf(37.5, 127.1, 30));
    expect(out!.relativeBearing).toBeUndefined();
    expect(out!.bearingUnavailable).toBe("degenerateGeometry");
  });

  it("창(15m)보다 짧은 경로는 전체를 쓴다", () => {
    const route = buildGuideRoute([
      {
        description: "짧은 직진",
        pathCoords: [
          { lat: 37.5, lng: 127.1 },
          { lat: 37.5 + 6 / 111320, lng: 127.1 },
        ],
      },
    ])!;
    const end = route.polyline.points[1];
    const out = computeFinalApproach(route, eastOf(end.lat, end.lng, 30));
    expect(out!.relativeBearing).toBeCloseTo(90, 0);
  });

  it("창에 걸친 세그먼트는 겹치는 길이만 가중한다 — 모퉁이를 돈 직후", () => {
    // 100m 북진 후 동쪽 10m(모퉁이를 돌았다). 목적지는 그대로 동쪽 30m 앞.
    // 걸친 세그먼트를 통째로 넣으면 100m가 가중치를 지배해 방위가 북쪽으로 남고,
    // 이미 목적지를 향해 선 사용자에게 "오른쪽"을 말한다.
    const corner = { lat: 37.5 + 100 / 111320, lng: 127.1 };
    const end = eastOf(corner.lat, corner.lng, 10);
    const route = buildGuideRoute([
      {
        description: "북진 후 우회전",
        pathCoords: [{ lat: 37.5, lng: 127.1 }, corner, end],
      },
    ])!;
    const out = computeFinalApproach(route, eastOf(end.lat, end.lng, 30));
    expect(relativeDirection(out!.relativeBearing!)).toBe("ahead");
  });
});

/** fixture 좌표 규약(파일 상단 comment 참조). Kit FinalApproachTests와 동일 하니스. */
const M_PER_DEG_LAT = 111320;
const mPerDegLng = 111320 * Math.cos((37.5 * Math.PI) / 180);
const toCoord = ([along, lateral]: number[]) => ({
  lat: 37.5 + along / M_PER_DEG_LAT,
  lng: 127.1 + lateral / mPerDegLng,
});

interface FixtureScenario {
  name: string;
  segments: number[][];
  dest: number[];
  expect: {
    offsetMeters?: number;
    relativeBearing?: number;
    bearingUnavailable?: string;
    direction?: string;
  };
}

describe("공유 fixture (웹↔Kit 동조)", () => {
  for (const s of fixtures.scenarios as FixtureScenario[]) {
    it(s.name, () => {
      const route = buildGuideRoute([
        { description: "고정", pathCoords: s.segments.map(toCoord) },
      ])!;
      const out = computeFinalApproach(route, toCoord(s.dest));
      expect(out).not.toBeNull();
      if (s.expect.offsetMeters !== undefined) {
        expect(out!.offsetMeters).toBeCloseTo(s.expect.offsetMeters, 0);
      }
      if (s.expect.relativeBearing !== undefined) {
        expect(out!.relativeBearing).toBeCloseTo(s.expect.relativeBearing, 0);
      }
      if (s.expect.bearingUnavailable !== undefined) {
        expect(out!.bearingUnavailable).toBe(s.expect.bearingUnavailable);
        expect(out!.relativeBearing).toBeUndefined();
      }
      if (s.expect.direction !== undefined) {
        expect(relativeDirection(out!.relativeBearing!)).toBe(s.expect.direction);
      }
    });
  }
});

describe("relativeDirection 경계 소유권", () => {
  it.each([
    [0, "ahead"],
    [45, "ahead"],
    [45.1, "right"],
    [-45, "ahead"],
    [-45.1, "left"],
    [135, "right"],
    [135.1, "behind"],
    [-135, "left"],
    [-135.1, "behind"],
    [180, "behind"],
    [-180, "behind"],
  ] as const)("%s도 → %s", (theta, expected) => {
    expect(relativeDirection(theta)).toBe(expected);
  });
});

// ── 도착 추정(잊힌 세션 정리, spec 2026-08-13) ──────────────────────────────
// 좌표는 위 공유 fixture 하니스의 toCoord(미터 오프셋 → 위경도)를 재사용한다.

const PROFILES: Record<string, PresumedArrivalThresholds> = {
  walk: PRESUMED_ARRIVAL_WALK,
  car: PRESUMED_ARRIVAL_CAR,
};

describe("presumedArrivalStep (공유 fixture)", () => {
  for (const s of presumedFixture.stepScenarios) {
    it(s.name, () => {
      const thresholds = PROFILES[s.profile];
      expect(thresholds, `미지 프로파일 ${s.profile}`).toBeDefined();
      expect(presumedArrivalStep(s.input as PresumedArrivalInput, thresholds)).toBe(s.expect);
    });
  }

  it("프로파일: car는 두절이 더 짧고 나머지는 같다(spec 2026-08-31 §3.2)", () => {
    expect(PRESUMED_ARRIVAL_CAR.noFixSeconds).toBeLessThan(PRESUMED_ARRIVAL_WALK.noFixSeconds);
    expect(PRESUMED_ARRIVAL_CAR.stationarySeconds).toBe(PRESUMED_ARRIVAL_WALK.stationarySeconds);
    expect(PRESUMED_ARRIVAL_CAR.maxDistanceMeters).toBe(PRESUMED_ARRIVAL_WALK.maxDistanceMeters);
  });

  it("무효 입력(음수·NaN·무한)은 null", () => {
    const base: PresumedArrivalInput = {
      inFinalApproach: true,
      secondsSinceUsableFix: 200,
      secondsSinceProgress: 0,
      lastKnownDistanceToDestMeters: 20,
    };
    expect(presumedArrivalStep({ ...base, secondsSinceUsableFix: -1 }, PRESUMED_ARRIVAL_WALK)).toBeNull();
    expect(presumedArrivalStep({ ...base, secondsSinceUsableFix: NaN }, PRESUMED_ARRIVAL_WALK)).toBeNull();
    expect(presumedArrivalStep({ ...base, secondsSinceProgress: Infinity }, PRESUMED_ARRIVAL_WALK)).toBeNull();
    expect(
      presumedArrivalStep({ ...base, lastKnownDistanceToDestMeters: NaN }, PRESUMED_ARRIVAL_WALK),
    ).toBeNull();
    expect(
      presumedArrivalStep({ ...base, lastKnownDistanceToDestMeters: -5 }, PRESUMED_ARRIVAL_WALK),
    ).toBeNull();
  });
});

describe("advanceProgressAnchor (공유 fixture)", () => {
  for (const s of presumedFixture.anchorScenarios) {
    it(s.name, () => {
      let anchor: { lat: number; lng: number } | null = null;
      const progressedAt: number[] = [];
      s.steps.forEach((step, i) => {
        const out = advanceProgressAnchor(anchor, toCoord(step), s.epsilonMeters);
        anchor = out.anchor;
        if (out.progressed) progressedAt.push(i);
      });
      expect(progressedAt).toEqual(s.expectProgressedAt);
    });
  }
});
