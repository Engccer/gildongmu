import { describe, expect, it } from "vitest";
import { normalizeTmapWalkRoute } from "../tmap-pedestrian";

const point = (turnType: number, description: string, lng = 127.1, lat = 37.5) => ({
  type: "Feature" as const,
  geometry: { type: "Point" as const, coordinates: [lng, lat] as [number, number] },
  properties: {
    turnType,
    description,
    ...(turnType === 200 ? { totalDistance: 500, totalTime: 400 } : {}),
  },
});
const line = (distance: number, name: string, coords: [number, number][]) => ({
  type: "Feature" as const,
  geometry: { type: "LineString" as const, coordinates: coords },
  properties: { distance, name },
});

describe("normalizeTmapWalkRoute 구조화 투영", () => {
  it("turnType·첫 LineString의 도로명·거리를 스텝에 싣는다(en 전용)", () => {
    const b = normalizeTmapWalkRoute({
      type: "FeatureCollection",
      features: [
        point(200, "보행자도로를 따라 30m 이동"),
        line(30, "", [
          [127.1, 37.5],
          [127.101, 37.5],
        ]),
        point(13, "우회전 후 진황도로를 따라 294m 이동"),
        line(294, "진황도로", [
          [127.101, 37.5],
          [127.104, 37.5],
        ]),
        line(8, "논현로", [
          [127.104, 37.5],
          [127.105, 37.5],
        ]),
      ],
    }, { guard: true });
    expect(b.steps[0]).toMatchObject({ turnType: 200, distanceMeters: 30 });
    expect(b.steps[0].roadNameKo).toBeUndefined();
    expect(b.steps[1]).toMatchObject({
      turnType: 13,
      action: "right",
      roadNameKo: "진황도로",
      distanceMeters: 294,
    });
  });

  it("귀속은 합이 아니라 첫 구간이다", () => {
    const b = normalizeTmapWalkRoute({
      type: "FeatureCollection",
      features: [
        point(200, "306m 이동"),
        line(306, "봉은사로", [
          [127.1, 37.5],
          [127.103, 37.5],
        ]),
        line(8, "논현로", [
          [127.103, 37.5],
          [127.1031, 37.5],
        ]),
      ],
    }, { guard: true });
    expect(b.steps[0].distanceMeters).toBe(306);
    expect(b.steps[0].roadNameKo).toBe("봉은사로");
  });

  // ⚠ ko(기본)에서는 문장 축을 붙이지 않는다 — 붙이면 `rewriteWalkGuidance`의 meters-게이트
  // 규칙 3종이 ko 폴백 문장에 새로 걸리고, CROSS는 첫 구간 거리를 "횡단보도 길이"라고
  // 이름 붙여 낭독되는 수치가 무엇의 값인지 틀린다(품질 리뷰 검출).
  it("ko(guard=false)에서는 거리·도로명을 붙이지 않는다 — 종전 문장 불변", () => {
    const b = normalizeTmapWalkRoute({
      type: "FeatureCollection",
      features: [
        point(200, "306m 이동"),
        line(306, "봉은사로", [
          [127.1, 37.5],
          [127.103, 37.5],
        ]),
      ],
    });
    expect(b.steps[0].distanceMeters).toBeUndefined();
    expect(b.steps[0].roadNameKo).toBeUndefined();
    expect(b.steps[0].turnType).toBe(200); // 행동 축은 ko에서도 붙는다
  });

  it("소수 거리는 반올림한다(iOS 엄격 Int 디코딩 — 하나가 브리핑 전체를 죽인다)", () => {
    const b = normalizeTmapWalkRoute({
      type: "FeatureCollection",
      features: [
        point(200, "31m 이동"),
        line(30.6, "", [
          [127.1, 37.5],
          [127.103, 37.5],
        ]),
      ],
    }, { guard: true });
    expect(b.steps[0].distanceMeters).toBe(31);
  });

  const contradicting = {
    type: "FeatureCollection" as const,
    features: [
      point(200, "30m 이동"),
      line(30, "", [
        [127.1, 37.5],
        [127.101, 37.5],
      ]),
      point(13, "좌회전 후 30m 이동"),
      line(30, "", [
        [127.101, 37.5],
        [127.102, 37.5],
      ]),
    ],
  };

  it("guard=true면 원문과 모순되는 turnType에 throw", () => {
    expect(() => normalizeTmapWalkRoute(contradicting, { guard: true })).toThrow(/표지/);
  });

  it("guard=false(기본)면 종전대로 통과 — ko 폴백 동작 불변", () => {
    expect(() => normalizeTmapWalkRoute(contradicting)).not.toThrow();
  });

  it("guard=true면 미지 turnType에 throw", () => {
    expect(() =>
      normalizeTmapWalkRoute(
        {
          type: "FeatureCollection",
          features: [
            point(200, "30m 이동"),
            line(30, "", [
              [127.1, 37.5],
              [127.101, 37.5],
            ]),
            point(9999, "무언가 30m 이동"),
            line(30, "", [
              [127.101, 37.5],
              [127.102, 37.5],
            ]),
          ],
        },
        { guard: true },
      ),
    ).toThrow(/미지/);
  });

  it("pathCoords는 종전대로 전부 귀속한다(기하는 실경로를 따라야 한다)", () => {
    const b = normalizeTmapWalkRoute(
      {
        type: "FeatureCollection",
        features: [
          point(200, "306m 이동"),
          line(306, "봉은사로", [
            [127.1, 37.5],
            [127.103, 37.5],
          ]),
          line(8, "논현로", [
            [127.103, 37.5],
            [127.1031, 37.5],
          ]),
        ],
      },
      { includeLineGeometry: true },
    );
    expect(b.steps[0].pathCoords).toHaveLength(3);
  });
});
