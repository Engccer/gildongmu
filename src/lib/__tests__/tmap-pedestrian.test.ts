import { describe, it, expect } from "vitest";
import {
  normalizeTmapWalkRoute,
  type TmapRouteResponse,
} from "@/lib/providers/tmap-pedestrian";

// Tmap 보행자 경로안내 실응답 축약본(2026-07-21 길동 실호출로 확정, 전체 24단계 중 일부 발췌).
// 첫 Point feature에 totalDistance=2078·totalTime=1806이 실려 있고, 안내 지점은
// Point feature의 description(완성 문장)으로만 온다. LineString은 폴리라인
// 좌표라 description이 있어도 지도 없는 이 앱에선 쓰지 않는다(Point만 정본).
// 경유 좌표점(pointType "B")은 description이 없다.
const sample: TmapRouteResponse = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [127.1368, 37.5385] },
      properties: {
        index: 0,
        pointIndex: 0,
        name: "5",
        description: "출발지",
        turnType: 200,
        pointType: "S",
        totalDistance: 2078,
        totalTime: 1806,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [127.1368, 37.5385],
          [127.1352, 37.537],
        ],
      },
      properties: { index: 0, distance: 158, time: 130 },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [127.1352, 37.537] },
      properties: {
        pointIndex: 1,
        description: "천호대로 방면으로 158m 이동 후 우회전",
        turnType: 12,
        pointType: "GP",
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [127.1352, 37.537],
          [127.132, 37.5345],
        ],
      },
      properties: { index: 1, distance: 300, time: 250 },
    },
    {
      // 경유 좌표점. description 없음(사용자에게 안내할 문장이 없는 지점), 제외 대상.
      type: "Feature",
      geometry: { type: "Point", coordinates: [127.132, 37.5345] },
      properties: { pointIndex: 2, pointType: "B" },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [127.132, 37.5345],
          [127.128, 37.531],
        ],
      },
      properties: { index: 2, distance: 340, time: 280 },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [127.128, 37.531] },
      properties: {
        pointIndex: 3,
        description: "강동구청사거리에서 좌회전 후 340m 이동",
        turnType: 2,
        pointType: "GP",
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [127.128, 37.531],
          [127.126, 37.53],
        ],
      },
      properties: { index: 3, distance: 100, time: 90 },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [127.126, 37.53] },
      properties: {
        pointIndex: 4,
        description: "도착",
        turnType: 201,
        pointType: "E",
      },
    },
  ],
};

describe("normalizeTmapWalkRoute", () => {
  it("Point feature의 description만 순서대로 추출한다", () => {
    const { steps } = normalizeTmapWalkRoute(sample);
    expect(steps.map((s) => s.description)).toEqual([
      "출발지",
      "천호대로 방면으로 158m 이동 후 우회전",
      "강동구청사거리에서 좌회전 후 340m 이동",
      "도착",
    ]);
  });

  it("첫 Point의 totalDistance/totalTime을 총계로 투영한다", () => {
    const { distanceMeters, durationSeconds } = normalizeTmapWalkRoute(sample);
    expect(distanceMeters).toBe(2078);
    expect(durationSeconds).toBe(1806);
  });

  it("totalTime이 비유한/0이면 throw한다", () => {
    const zeroTotalTime: TmapRouteResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [127.1368, 37.5385] },
          properties: {
            description: "출발지",
            totalDistance: 2078,
            totalTime: 0,
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [127.126, 37.53] },
          properties: { description: "도착" },
        },
      ],
    };
    expect(() => normalizeTmapWalkRoute(zeroTotalTime)).toThrow(
      "Tmap 보행자 경로 정규화 실패",
    );
  });

  it("description 있는 Point가 0개(steps 0개)면 throw한다", () => {
    const noSteps: TmapRouteResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [127.1368, 37.5385] },
          properties: { totalDistance: 500, totalTime: 400 },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [127.1368, 37.5385],
              [127.126, 37.53],
            ],
          },
          properties: { distance: 500, time: 400 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [127.126, 37.53] },
          properties: {},
        },
      ],
    };
    expect(() => normalizeTmapWalkRoute(noSteps)).toThrow(
      "Tmap 보행자 경로 정규화 실패",
    );
  });

  it("description 없는 Point(경유 좌표점)는 제외한다", () => {
    const { steps } = normalizeTmapWalkRoute(sample);
    // 원본 Point feature는 5개(출발+안내2+경유1+도착)이나 경유점은 description이
    // 없어 제외되어 4개만 남는다.
    expect(steps).toHaveLength(4);
  });
});
