import { describe, expect, it } from "vitest";
import type { TransitRoute, TransitVehicle } from "@/lib/types";
import { annotateHighlights as annotate, requeryAxesFor, selectTransitRoutes } from "../odsay-select";

/** 후보 전체를 따로 주지 않는 케이스는 선정 결과 자체를 후보로 본다 */
const annotateHighlights = (selected: TransitRoute[], candidates: TransitRoute[] | number) =>
  annotate(selected, typeof candidates === "number" ? selected : candidates);

/** 최소 골격 경로 생성기. serviceStatus는 탑승 leg에 싣는다 */
function route(
  key: string,
  totalMinutes: number,
  transfers: number,
  opts: {
    status?: "running" | "outside" | "unknown";
    walkMeters?: number | null;
    walkMinutes?: number;
    vehicle?: TransitVehicle;
  } = {},
): TransitRoute {
  const { status = "running", walkMeters = 300, walkMinutes = 5, vehicle } = opts;
  return {
    summary: {
      totalMinutes,
      fare: 1500,
      transfers,
      walkMinutes,
      ...(walkMeters != null ? { walkMeters } : {}),
    },
    legs: [{ mode: "bus", minutes: totalMinutes, serviceStatus: status }],
    routeKey: key,
    ...(vehicle ? { vehicle } : {}),
  };
}

const keysOf = (routes: TransitRoute[]) => routes.map((r) => r.routeKey);

describe("selectTransitRoutes", () => {
  it("1순위 + 축 경로만 고르고 번호로 채우지 않는다(E50 판정 1)", () => {
    // 실측 구조(길동→서울역): 무환승 370번 버스만이 8번째
    const routes = [
      route("p0", 43, 1, { vehicle: "subway", walkMeters: 319, walkMinutes: 7 }),
      route("p1", 50, 1, { walkMeters: 544, walkMinutes: 8 }),
      route("p2", 51, 1, { walkMeters: 582, walkMinutes: 8 }),
      route("p3", 60, 1, { walkMeters: 655, walkMinutes: 10 }),
      route("p7", 71, 0, { vehicle: "bus", walkMeters: 1246, walkMinutes: 18 }),
    ];
    expect(keysOf(selectTransitRoutes(routes))).toEqual(["p0", "p7"]);
  });

  it("축 5개가 전부 서면 1 + 5", () => {
    const routes = [
      route("p0", 40, 2, { walkMeters: 500, walkMinutes: 8 }),
      route("p1", 30, 2, { walkMeters: 600, walkMinutes: 9 }), // fastest
      route("p2", 50, 0, { walkMeters: 700, walkMinutes: 10 }), // fewestTransfers
      route("p3", 45, 1, { walkMeters: 100, walkMinutes: 2 }), // leastWalk
      route("p4", 55, 1, { vehicle: "bus", walkMeters: 800, walkMinutes: 12 }), // busOnly
      route("p5", 48, 1, { vehicle: "subway", walkMeters: 900, walkMinutes: 12 }), // subwayOnly
      route("p6", 60, 1, { walkMeters: 900, walkMinutes: 12 }), // 이유 없음
    ];
    expect(keysOf(selectTransitRoutes(routes))).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });

  it("결과는 축 순서가 아니라 순위 순서다", () => {
    const routes = [
      route("p0", 40, 2),
      route("p1", 50, 0), // fewestTransfers(순위 앞)
      route("p2", 30, 2), // fastest(순위 뒤)
    ];
    expect(keysOf(selectTransitRoutes(routes))).toEqual(["p0", "p1", "p2"]);
  });

  it("운행 밖 경로는 모든 축 후보에서 빠진다", () => {
    const routes = [
      route("p0", 45, 1, { vehicle: "subway" }),
      route("p5", 30, 0, { status: "outside", vehicle: "bus", walkMeters: 10, walkMinutes: 1 }),
    ];
    expect(keysOf(selectTransitRoutes(routes))).toEqual(["p0"]);
  });

  it("경로가 하나면 그것만", () => {
    expect(keysOf(selectTransitRoutes([route("p0", 20, 0)]))).toEqual(["p0"]);
  });

  it("1순위보다 나은 축이 없으면 1순위만", () => {
    const routes = [route("p0", 10, 0), route("p1", 20, 0), route("p2", 30, 0)];
    expect(keysOf(selectTransitRoutes(routes))).toEqual(["p0"]);
  });

  describe("동률 2차 키(PORTS.md pickBest)", () => {
    it("환승이 같으면 빠른 쪽", () => {
      const routes = [route("p0", 40, 2), route("p1", 60, 0), route("p2", 55, 0)];
      const result = annotateHighlights(selectTransitRoutes(routes), 3);
      expect(result.alternatives.find((a) => a.highlight?.includes("fewestTransfers"))?.routeKey).toBe("p2");
    });

    it("시간이 같으면 환승이 적은 쪽", () => {
      const routes = [route("p0", 40, 2), route("p1", 30, 2), route("p2", 30, 1)];
      const result = annotateHighlights(selectTransitRoutes(routes), 3);
      expect(result.alternatives.find((a) => a.highlight?.includes("fastest"))?.routeKey).toBe("p2");
    });

    it("도보 거리가 같으면 빠른 쪽", () => {
      const routes = [
        route("p0", 40, 0, { walkMeters: 500, walkMinutes: 8 }),
        route("p1", 55, 0, { walkMeters: 100, walkMinutes: 2 }),
        route("p2", 50, 0, { walkMeters: 100, walkMinutes: 2 }),
      ];
      expect(keysOf(selectTransitRoutes(routes))).toEqual(["p0", "p2"]);
    });

    it("도보 거리가 같으면 도보 분이 짧은 쪽이 소요 분보다 먼저다", () => {
      const routes = [
        route("p0", 40, 0, { walkMeters: 500, walkMinutes: 8 }),
        route("p1", 45, 0, { walkMeters: 100, walkMinutes: 4 }),
        route("p2", 50, 0, { walkMeters: 100, walkMinutes: 2 }),
      ];
      expect(keysOf(selectTransitRoutes(routes))).toEqual(["p0", "p2"]);
    });

    it("수단 축은 그 수단 안에서 빠른 쪽", () => {
      const routes = [
        route("p0", 40, 1, { vehicle: "subway" }),
        route("p1", 70, 0, { vehicle: "bus" }),
        route("p2", 60, 1, { vehicle: "bus" }),
      ];
      const result = annotateHighlights(selectTransitRoutes(routes), 3);
      expect(result.alternatives.find((a) => a.highlight?.includes("busOnly"))?.routeKey).toBe("p2");
    });

    it("2차 키까지 같으면 순위가 앞선 쪽 — 선정과 라벨이 같은 경로를 고른다", () => {
      const routes = [
        route("p0", 40, 2, { vehicle: "subway" }),
        route("p1", 50, 0, { vehicle: "bus" }), // busOnly + fewestTransfers
        route("p2", 50, 0), // fewestTransfers 동률(순위 뒤)
      ];
      const result = annotateHighlights(selectTransitRoutes(routes), 3);
      expect(result.alternatives.map((a) => [a.routeKey, a.highlight])).toEqual([
        ["p1", ["fewestTransfers", "busOnly"]],
      ]);
    });
  });

  describe("도보 축", () => {
    it("거리는 짧아도 도보 분이 늘면 싣지 않는다(부산 실측)", () => {
      const routes = [
        route("p0", 20, 0, { walkMeters: 113, walkMinutes: 2 }),
        route("p1", 25, 0, { walkMeters: 90, walkMinutes: 5 }),
      ];
      expect(keysOf(selectTransitRoutes(routes))).toEqual(["p0"]);
    });

    it("도보 분이 같으면 싣는다", () => {
      const routes = [
        route("p0", 20, 0, { walkMeters: 300, walkMinutes: 5 }),
        route("p1", 25, 0, { walkMeters: 250, walkMinutes: 5 }),
      ];
      expect(annotateHighlights(selectTransitRoutes(routes), 2).alternatives[0].highlight).toEqual(["leastWalk"]);
    });

    it("도보 거리를 모르면 참여하지 않는다(모름을 0m로 읽지 않는다)", () => {
      expect(keysOf(selectTransitRoutes([route("p0", 20, 0), route("p1", 25, 0, { walkMeters: null, walkMinutes: 1 })]))).toEqual(["p0"]);
      expect(keysOf(selectTransitRoutes([route("p0", 20, 0, { walkMeters: null }), route("p1", 25, 0, { walkMeters: 1, walkMinutes: 1 })]))).toEqual(["p0"]);
    });
  });

  describe("수단 축", () => {
    it("1순위가 그 수단이면 그 축은 서지 않는다", () => {
      const routes = [route("p0", 40, 0, { vehicle: "bus" }), route("p1", 50, 0, { vehicle: "bus" })];
      expect(keysOf(selectTransitRoutes(routes))).toEqual(["p0"]);
    });

    it("혼합 경로(vehicle 부재)는 수단 축 후보가 아니다", () => {
      const routes = [route("p0", 40, 0, { vehicle: "subway" }), route("p1", 50, 0)];
      expect(keysOf(selectTransitRoutes(routes))).toEqual(["p0"]);
    });
  });
});

describe("annotateHighlights", () => {
  it("축은 조립 순서(fastest, fewestTransfers, leastWalk, busOnly, subwayOnly)로 싣는다", () => {
    const result = annotateHighlights([route("p0", 45, 1, { vehicle: "subway" }), route("p1", 30, 0, { vehicle: "bus" })], 5);
    expect(result.alternatives[0].highlight).toEqual(["fastest", "fewestTransfers", "busOnly"]);
  });

  it("옛 앱이 아는 축이 없는 대안에만 1부터 옛 앱용 번호를 싣는다", () => {
    const result = annotateHighlights(
      [
        route("p0", 45, 1, { vehicle: "subway", walkMeters: 500, walkMinutes: 8 }),
        route("p1", 71, 0), // fewestTransfers → 번호 없음
        route("p2", 50, 1, { vehicle: "bus" }), // busOnly만 → 1
        route("p3", 52, 1, { walkMeters: 100, walkMinutes: 2 }), // leastWalk만 → 2
      ],
      9,
    );
    expect(result.alternatives.map((a) => a.displayIndex)).toEqual([undefined, 1, 2]);
    expect(result.totalCandidates).toBe(4);
  });

  it("1순위 자신은 라벨을 갖지 않는다", () => {
    const result = annotateHighlights([route("p7", 71, 0), route("p0", 45, 1)], 9);
    expect(result.recommended.highlight).toBeUndefined();
    expect(result.alternatives[0].highlight).toEqual(["fastest"]);
  });

  it("재조회 제안은 표시 경로에 그 수단이 없을 때만", () => {
    expect(annotateHighlights([route("p0", 45, 1)], 1).requeryAxes).toEqual(["busOnly", "subwayOnly"]);
    expect(annotateHighlights([route("p0", 45, 1, { vehicle: "bus" })], 1).requeryAxes).toEqual(["subwayOnly"]);
    expect(
      annotateHighlights([route("p0", 45, 1, { vehicle: "subway" }), route("p1", 50, 1, { vehicle: "bus" })], 2).requeryAxes,
    ).toBeUndefined();
  });
});

describe("재조회 제안은 강등 뒤 전체 후보로 판정한다(설계 리뷰 #1)", () => {
  it("운행 종료라 표시되지 않은 버스만 경로가 후보에 있으면 버스 재조회를 제안하지 않는다", () => {
    const candidates = [
      route("p0", 45, 1, { vehicle: "subway" }),
      route("p1", 50, 1),
      route("p2", 60, 0, { status: "outside", vehicle: "bus" }),
    ];
    const result = annotate(selectTransitRoutes(candidates), candidates);
    expect(result.alternatives.map((a) => a.routeKey)).not.toContain("p2"); // 축에서는 빠진다
    expect(result.requeryAxes).toBeUndefined(); // 이미 쥔 답을 돈 내고 다시 받지 않는다
    expect(result.totalCandidates).toBe(3);
  });
});

describe("requeryAxesFor", () => {
  it("운행 종료 경로도 표시되면 그 수단은 이미 있는 것이다", () => {
    expect(requeryAxesFor([route("p0", 45, 1, { status: "outside", vehicle: "bus" })])).toEqual(["subwayOnly"]);
  });
});
