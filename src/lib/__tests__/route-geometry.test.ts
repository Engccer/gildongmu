import { describe, expect, it } from "vitest";
import { buildGuideRoute, projectOnPolyline, globalCandidates, tangentAt } from "../route-geometry";

// 위도 1도 ≈ 111,320m. 미터를 위도로 환산해 남북 직선 경로를 만든다(Kit 미러 fixture와 동일 규약).
const M = 1 / 111320;
const pt = (m: number, lngOff = 0) => ({
  lat: 37.5 + m * M,
  lng: 127.1 + (lngOff * M) / Math.cos((37.5 * Math.PI) / 180),
});

describe("buildGuideRoute", () => {
  it("이음매 연속 경로를 스텝 스팬으로 조립한다", () => {
    const r = buildGuideRoute([
      { description: "100m 이동", pathCoords: [pt(0), pt(100)] },
      { description: "횡단보도 이용", pathCoords: [pt(100), pt(120)] },
    ]);
    expect(r).not.toBeNull();
    expect(r!.totalMeters).toBeCloseTo(120, 0);
    expect(r!.steps[0]).toMatchObject({ startD: 0, isLong: true });
    expect(r!.steps[0].endD).toBeCloseTo(100, 0);
    expect(r!.steps[1].isLong).toBe(false); // 20m < LONG_STEP_MIN
  });

  it("검증 실패는 null: 기하 없는 스텝", () => {
    expect(buildGuideRoute([{ description: "이동" }])).toBeNull();
  });

  it("검증 실패는 null: 이음매 불연속 > 5m", () => {
    expect(
      buildGuideRoute([
        { description: "a", pathCoords: [pt(0), pt(100)] },
        { description: "b", pathCoords: [pt(110), pt(200)] },
      ]),
    ).toBeNull();
  });

  it("검증 실패는 null: 비유한 좌표", () => {
    expect(
      buildGuideRoute([{ description: "a", pathCoords: [pt(0), { lat: NaN, lng: 127.1 }] }]),
    ).toBeNull();
  });

  it("검증 실패는 null: 스텝 0개·총 길이 0", () => {
    expect(buildGuideRoute([])).toBeNull();
    expect(buildGuideRoute([{ description: "a", pathCoords: [pt(0)] }])).toBeNull();
  });
});

describe("projectOnPolyline", () => {
  const poly = buildGuideRoute([{ description: "a", pathCoords: [pt(0), pt(300)] }])!.polyline;

  it("창 안 투영: 진행거리·수직거리", () => {
    const pr = projectOnPolyline(poly, pt(150, 10), 100, 200)!;
    expect(pr.d).toBeCloseTo(150, 0);
    expect(pr.perpMeters).toBeCloseTo(10, 0);
  });

  it("창 밖이면 창 경계로 클램프된 투영을 준다", () => {
    const pr = projectOnPolyline(poly, pt(250), 0, 200)!;
    expect(pr.d).toBeCloseTo(200, 0);
  });

  it("창과 겹치는 세그먼트가 없으면 null", () => {
    expect(projectOnPolyline(poly, pt(150), 400, 500)).toBeNull();
  });
});

describe("globalCandidates", () => {
  it("자기근접(U자 왕복) 경로는 후보 2개", () => {
    // 북으로 300m, 동으로 20m, 남으로 300m 복귀 — 평행 왕복 20m 간격.
    const r = buildGuideRoute([
      { description: "북", pathCoords: [pt(0), pt(300)] },
      { description: "동", pathCoords: [pt(300), pt(300, 20)] },
      { description: "남", pathCoords: [pt(300, 20), pt(0, 20)] },
    ])!;
    const c = globalCandidates(r.polyline, pt(150, 10), 30);
    expect(c.length).toBe(2); // 북행·남행 두 갈래에 모두 근접
  });

  it("단일 직선은 후보 1개", () => {
    const r = buildGuideRoute([{ description: "a", pathCoords: [pt(0), pt(300)] }])!;
    expect(globalCandidates(r.polyline, pt(150, 5), 30)).toHaveLength(1);
  });

  it("경로에서 멀면 후보 0개", () => {
    const r = buildGuideRoute([{ description: "a", pathCoords: [pt(0), pt(300)] }])!;
    expect(globalCandidates(r.polyline, pt(150, 200), 30)).toHaveLength(0);
  });
});

describe("tangentAt", () => {
  // 남 → 북 직선 100m
  const straight = buildGuideRoute([
    {
      description: "북진",
      pathCoords: [
        { lat: 37.5, lng: 127.1 },
        { lat: 37.5 + 100 / 111320, lng: 127.1 },
      ],
    },
  ])!;

  it("직선 구간은 진행 방위 0도", () => {
    expect(tangentAt(straight.polyline, 50, 15)).toBeCloseTo(0, 0);
  });

  it("경로 시작·끝에서도 방위를 낸다(구간을 잘라 쓴다)", () => {
    expect(tangentAt(straight.polyline, 0, 15)).toBeCloseTo(0, 0);
    expect(tangentAt(straight.polyline, 100, 15)).toBeCloseTo(0, 0);
  });

  it("앞뒤 점이 같으면 null (0도로 접지 않는다)", () => {
    const degenerate = { points: [{ lat: 37.5, lng: 127.1 }], cum: [0] };
    expect(tangentAt(degenerate, 0, 15)).toBeNull();
  });

  it("직각으로 꺾이는 지점의 접선은 두 방위 사이", () => {
    // 북 50m 뒤 동 50m
    const corner = buildGuideRoute([
      {
        description: "북",
        pathCoords: [
          { lat: 37.5, lng: 127.1 },
          { lat: 37.5 + 50 / 111320, lng: 127.1 },
        ],
      },
      {
        description: "동",
        pathCoords: [
          { lat: 37.5 + 50 / 111320, lng: 127.1 },
          {
            lat: 37.5 + 50 / 111320,
            lng: 127.1 + 50 / (111320 * Math.cos((37.5 * Math.PI) / 180)),
          },
        ],
      },
    ])!;
    const t = tangentAt(corner.polyline, 50, 15)!;
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(70);
  });
});

describe("0-길이 유령 스텝 가드(리뷰 MEDIUM — fail-closed 복원)", () => {
  it("직전 끝점과 동일한 1점뿐인 중간 스텝은 null", () => {
    expect(
      buildGuideRoute([
        { description: "a", pathCoords: [pt(0), pt(100)] },
        { description: "0m 지시", pathCoords: [pt(100)] },
        { description: "b", pathCoords: [pt(100), pt(200)] },
      ]),
    ).toBeNull();
  });
});
