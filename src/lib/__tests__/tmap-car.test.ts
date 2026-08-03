import { describe, expect, it } from "vitest";
import { normalizeTmapCarRoute, type TmapCarResponse } from "../providers/tmap-car";

/** Step 1 실호출 캡처(길동→강남) 축약 fixture. 필드명·중첩은 원문 그대로. */
function fixture(): TmapCarResponse {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [127.1435, 37.538] },
        properties: {
          totalDistance: 18651.4,
          totalTime: 2712.6,
          totalFare: 0,
          taxiFare: 21300.2,
          description: "출발지에서 좌회전",
        },
      },
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[127.1435, 37.538], [127.14, 37.537]] },
        properties: { distance: 244, time: 60 },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [127.14, 37.537] },
        properties: { description: "교차로에서 우회전 후 명일로를 따라 244m 이동" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [127.0276, 37.4979] },
        properties: {},
      },
    ],
  };
}

describe("normalizeTmapCarRoute", () => {
  it("첫 Point의 총계 4필드를 반올림 투영한다(iOS 엄격 Int 디코딩)", () => {
    const out = normalizeTmapCarRoute(fixture());
    expect(out.distanceMeters).toBe(18651);
    expect(out.durationSeconds).toBe(2713);
    expect(out.tollFare).toBe(0);
    expect(out.taxiFare).toBe(21300);
  });

  it("description 있는 Point만 guide가 되고 name은 빈 문자열, 수치는 0(문장 내장 정본)", () => {
    const out = normalizeTmapCarRoute(fixture());
    expect(out.guides).toEqual([
      { name: "", guidance: "출발지에서 좌회전", distanceMeters: 0, durationSeconds: 0 },
      {
        name: "",
        guidance: "교차로에서 우회전 후 명일로를 따라 244m 이동",
        distanceMeters: 0,
        durationSeconds: 0,
      },
    ]);
  });

  it("totalFare 부재는 통행료 0으로 투영한다(무통행 구간 관례)", () => {
    const data = fixture();
    delete (data.features[0].properties as Record<string, unknown>).totalFare;
    expect(normalizeTmapCarRoute(data).tollFare).toBe(0);
  });

  it("총 거리·시간·택시요금이 유한 양수/유한이 아니면 throw(3-state — 깨진 경로 확정 낭독 금지)", () => {
    for (const key of ["totalDistance", "totalTime", "taxiFare"]) {
      const data = fixture();
      delete (data.features[0].properties as Record<string, unknown>)[key];
      expect(() => normalizeTmapCarRoute(data)).toThrow();
    }
  });

  it("안내 단계 0개면 throw", () => {
    const data = fixture();
    for (const f of data.features) delete (f.properties as Record<string, unknown>).description;
    expect(() => normalizeTmapCarRoute(data)).toThrow();
  });
});

/**
 * 기하 옵트인(B1 §5) — 실호출 구조 축약 재현: S(첫 안내) → L → N → L·L(Point 없이
 * LineString 연속) → E("도착" 마커). 좌표는 이음매가 정확히 이어지는 형태.
 */
function geometryFixture(): TmapCarResponse {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [127.1, 37.5] },
        properties: {
          pointType: "S",
          totalDistance: 1000,
          totalTime: 200,
          totalFare: 0,
          taxiFare: 5000,
          description: "올림픽로를 따라 200m 이동",
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[127.1, 37.5], [127.1, 37.502]],
        },
        properties: { name: "올림픽로", distance: 200, time: 30 },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [127.1, 37.502] },
        properties: {
          pointType: "N",
          description: "교차로에서 우회전 후 천호대로를 따라 800m 이동",
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[127.1, 37.502], [127.103, 37.502]],
        },
        properties: { name: "천호대로", distance: 300, time: 40 },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[127.103, 37.502], [127.108, 37.502]],
        },
        properties: { name: "일반도로", distance: 500, time: 80 },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [127.108, 37.502] },
        properties: { pointType: "E", description: "도착" },
      },
    ],
  };
}

describe("normalizeTmapCarRoute includeGeometry(B1 §5)", () => {
  it("미지정 응답에는 기하 키 자체가 없다(byte-호환 계약)", () => {
    const out = normalizeTmapCarRoute(geometryFixture());
    // 미지정 모드 guides는 기존 계약 그대로 — E("도착")도 문장이 있으니 포함된다.
    expect(out.guides.map((g) => g.guidance)).toEqual([
      "올림픽로를 따라 200m 이동",
      "교차로에서 우회전 후 천호대로를 따라 800m 이동",
      "도착",
    ]);
    for (const g of out.guides) {
      expect("pathCoords" in g).toBe(false);
      expect("roadLinks" in g).toBe(false);
    }
  });

  it("옵트인: S는 스텝, E는 마커 제외, Point 없는 LineString 연속은 같은 스텝에 병합", () => {
    const out = normalizeTmapCarRoute(geometryFixture(), { includeGeometry: true });
    expect(out.guides).toHaveLength(2); // "도착" 마커 제외
    const [first, second] = out.guides;
    // 스텝 기하 = Point 좌표 + 뒤따르는 LineString(이음매 중복 제거)
    expect(first.pathCoords).toEqual([
      { lat: 37.5, lng: 127.1 },
      { lat: 37.502, lng: 127.1 },
    ]);
    expect(second.pathCoords).toEqual([
      { lat: 37.502, lng: 127.1 },
      { lat: 37.502, lng: 127.103 },
      { lat: 37.502, lng: 127.108 },
    ]);
    // 링크별 도로명 — "일반도로"는 자리표시자라 null(가짜 정밀 금지)
    expect(second.roadLinks).toEqual([
      { name: "천호대로", distanceMeters: 300 },
      { name: null, distanceMeters: 500 },
    ]);
    // 표시 수치 계약 불변(문장 내장 정본)
    expect(first.distanceMeters).toBe(0);
    expect(first.durationSeconds).toBe(0);
  });
});
