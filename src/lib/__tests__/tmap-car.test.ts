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
