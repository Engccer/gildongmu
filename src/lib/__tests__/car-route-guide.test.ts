import { describe, expect, it } from "vitest";
import { buildCarGuide, roadNameAt } from "../car-route-guide";
import type { CarRouteBriefing } from "../types";

// 좌표 규약: 위도 1도 ≈ 111,320m — 남→북 직선(route-guide fixture 동형).
const M = 1 / 111320;
const pt = (m: number) => ({ lat: 37.5 + m * M, lng: 127.1 });

function briefing(overrides?: Partial<CarRouteBriefing>): CarRouteBriefing {
  return {
    distanceMeters: 500,
    durationSeconds: 120,
    taxiFare: 5000,
    tollFare: 0,
    provider: "tmap",
    guides: [
      {
        name: "",
        guidance: "직진 200m 이동",
        distanceMeters: 0,
        durationSeconds: 0,
        pathCoords: [pt(0), pt(200)],
        roadLinks: [{ name: "올림픽로", distanceMeters: 200 }],
      },
      {
        name: "",
        guidance: "우회전 후 300m 이동",
        distanceMeters: 0,
        durationSeconds: 0,
        pathCoords: [pt(200), pt(350), pt(500)],
        roadLinks: [
          { name: "천호대로", distanceMeters: 150 },
          { name: null, distanceMeters: 150 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("buildCarGuide (fail-closed, B1 §5)", () => {
  it("정상 조립: 스텝·도로명 스팬이 진행거리 축에 놓인다", () => {
    const out = buildCarGuide(briefing());
    expect(out).not.toBeNull();
    expect(out!.route.steps).toHaveLength(2);
    // 위도-미터 근사로 haversine 총거리가 ±1m 남짓 어긋날 수 있다.
    expect(out!.route.totalMeters).toBeCloseTo(500, -1);
    expect(out!.roadSpans).toEqual([
      { name: "올림픽로", startD: 0, endD: 200 },
      { name: "천호대로", startD: 200, endD: 350 },
      { name: null, startD: 350, endD: 500 },
    ]);
  });

  it("guide 하나라도 기하 결손이면 전체 null(부분 조립 금지)", () => {
    const b = briefing();
    delete b.guides[1].pathCoords;
    expect(buildCarGuide(b)).toBeNull();
  });

  it("좌표 NaN이면 전체 null", () => {
    const b = briefing();
    b.guides[0].pathCoords![1] = { lat: NaN, lng: 127.1 };
    expect(buildCarGuide(b)).toBeNull();
  });

  it("링크 합이 총거리와 5% 이상 어긋나면 도로명만 강등(경로 안내 유지)", () => {
    const b = briefing();
    b.guides[1].roadLinks = [{ name: "천호대로", distanceMeters: 30 }];
    const out = buildCarGuide(b);
    expect(out).not.toBeNull();
    expect(out!.route.steps).toHaveLength(2);
    expect(out!.roadSpans).toEqual([]);
  });

  it("종점 마커와 마지막 스텝 끝이 5m 초과로 어긋나면 전체 null(§5 커버리지)", () => {
    const b = briefing();
    b.terminalCoord = pt(560); // 마지막 스텝 끝 pt(500)과 ≈60m 어긋남
    expect(buildCarGuide(b)).toBeNull();
    // 일치하면 정상 조립
    const ok = briefing();
    ok.terminalCoord = pt(500);
    expect(buildCarGuide(ok)).not.toBeNull();
  });

  it("roadLinks 자체가 없으면 도로명 강등(경로 안내 유지)", () => {
    const b = briefing();
    delete b.guides[0].roadLinks;
    delete b.guides[1].roadLinks;
    const out = buildCarGuide(b);
    expect(out).not.toBeNull();
    expect(out!.roadSpans).toEqual([]);
  });
});

describe("roadNameAt", () => {
  const spans = buildCarGuide(briefing())!.roadSpans;

  it("진행거리가 속한 스팬의 도로명(무명은 null)", () => {
    expect(roadNameAt(spans, 0)).toBe("올림픽로");
    expect(roadNameAt(spans, 199)).toBe("올림픽로");
    expect(roadNameAt(spans, 200)).toBe("천호대로");
    expect(roadNameAt(spans, 400)).toBeNull(); // 무명 링크
  });

  it("종점 등호는 마지막 스팬 소속, 범위 밖·빈 스팬은 null", () => {
    expect(roadNameAt(spans, 500)).toBeNull(); // 마지막 스팬이 무명
    expect(roadNameAt(spans, 501)).toBeNull();
    expect(roadNameAt([], 100)).toBeNull();
  });
});
