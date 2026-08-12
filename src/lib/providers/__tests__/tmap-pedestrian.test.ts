import { describe, expect, it } from "vitest";
import {
  normalizeTmapWalkRoute,
  type TmapRouteResponse,
} from "../tmap-pedestrian";

// Point→LineString 교대 + description 없는 경유 Point 포함 fixture.
const FIXTURE: TmapRouteResponse = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [127.1, 37.5] },
      properties: {
        description: "158m 이동 후 우회전",
        totalDistance: 715,
        totalTime: 660,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [127.1, 37.5],
          [127.101, 37.5005],
        ],
      },
      properties: {},
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [127.101, 37.5005] },
      properties: { description: "도착" },
    },
  ],
};

describe("normalizeTmapWalkRoute 기하 보존", () => {
  it("기본(비기하)은 현행과 동일 — pathCoords 없음, coord만", () => {
    const b = normalizeTmapWalkRoute(FIXTURE);
    expect(b.steps[0].pathCoords).toBeUndefined();
    expect(b.steps[0].coord).toEqual({ lat: 37.5, lng: 127.1 });
  });

  it("includeLineGeometry는 직후 LineString을 그 스텝 pathCoords로 귀속한다", () => {
    const b = normalizeTmapWalkRoute(FIXTURE, { includeLineGeometry: true });
    expect(b.steps[0].pathCoords).toEqual([
      { lat: 37.5, lng: 127.1 },
      { lat: 37.5005, lng: 127.101 },
    ]);
  });

  it("Point 연속·LineString 다중도 순서 귀속이 깨지지 않는다", () => {
    // features: P1, L1a, L1b, P2 → P1.pathCoords = L1a+L1b 이어붙임
    const data: TmapRouteResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [127.1, 37.5] },
          properties: { description: "직진", totalDistance: 100, totalTime: 90 },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [127.1, 37.5],
              [127.1005, 37.5],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [127.1005, 37.5],
              [127.101, 37.5],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [127.101, 37.5] },
          properties: { description: "도착" },
        },
      ],
    };
    const b = normalizeTmapWalkRoute(data, { includeLineGeometry: true });
    expect(b.steps[0].pathCoords).toHaveLength(3); // 중복 접점 1개 제거
  });

  it("기하 모드는 기하 없는 후행 도착 마커를 떨군다(유령 스텝 — buildGuideRoute 전체 거부 방지)", () => {
    // Tmap 종점 "도착" Point는 후속 LineString이 없어 0길이 단일점이 된다.
    // 그대로 두면 buildGuideRoute가 경로 전체를 거부해 상세 안내가 조용히
    // 간략으로 강등된다(실호출 게이트 검출 2026-08-12). 카카오는 도착 스텝
    // 자체를 내지 않으므로 떨군 모양이 기존 소비자 계약과 정합.
    const b = normalizeTmapWalkRoute(FIXTURE, { includeLineGeometry: true });
    expect(b.steps).toHaveLength(1);
    expect(b.steps[0].description).toBe("158m 이동 후 우회전");
  });

  it("비기하 모드는 도착 마커를 유지한다(현행 브리핑 byte 동일)", () => {
    const b = normalizeTmapWalkRoute(FIXTURE);
    expect(b.steps).toHaveLength(2);
    expect(b.steps[1].description).toBe("도착");
  });

  it("description 없는 경유 Point는 귀속을 끊지 않는다", () => {
    // P1, L1, P(무설명), L2, P2 → P1.pathCoords = L1+L2
    const data: TmapRouteResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [127.1, 37.5] },
          properties: { description: "직진", totalDistance: 100, totalTime: 90 },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [127.1, 37.5],
              [127.1005, 37.5],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [127.1005, 37.5] },
          properties: {},
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [127.1005, 37.5],
              [127.101, 37.5],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [127.101, 37.5] },
          properties: { description: "도착" },
        },
      ],
    };
    const b = normalizeTmapWalkRoute(data, { includeLineGeometry: true });
    expect(b.steps[0].pathCoords).toHaveLength(3);
    expect(b.steps).toHaveLength(1); // 기하 없는 후행 "도착" 마커는 떨군다
  });
});
