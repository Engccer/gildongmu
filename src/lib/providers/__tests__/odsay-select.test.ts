import { describe, expect, it } from "vitest";
import type { TransitRoute } from "@/lib/types";
import { annotateHighlights, selectTransitRoutes } from "../odsay-select";

/** 최소 골격 경로 생성기. serviceStatus는 탑승 leg에 싣는다 */
function route(
  key: string,
  totalMinutes: number,
  transfers: number,
  status: "running" | "outside" | "unknown" = "running",
): TransitRoute {
  return {
    summary: { totalMinutes, fare: 1500, transfers, walkMinutes: 5 },
    legs: [{ mode: "bus", minutes: totalMinutes, serviceStatus: status }],
    routeKey: key,
  };
}

describe("selectTransitRoutes", () => {
  it("1순위 + 축 경로 + 정렬순 채움으로 5개까지 고른다", () => {
    // 실측 구조(길동→서울역): 무환승 370번이 7번째라 앞 3개로는 도달 불가
    const routes = [
      route("p0", 45, 1),
      route("p1", 52, 1),
      route("p2", 53, 1),
      route("p3", 54, 2),
      route("p4", 62, 1),
      route("p5", 55, 2),
      route("p6", 62, 1),
      route("p7", 71, 0),
      route("p8", 57, 2),
    ];
    const keys = selectTransitRoutes(routes).map((r) => r.routeKey);
    expect(keys[0]).toBe("p0");
    expect(keys).toContain("p7"); // 무환승이 축으로 뽑힌다
    expect(keys).toHaveLength(5);
  });

  it("운행 밖 경로는 축 후보에서 빠진다", () => {
    const routes = [
      route("p0", 45, 1),
      route("p1", 50, 1),
      route("p2", 51, 1),
      route("p3", 52, 1),
      route("p4", 53, 1),
      route("p5", 71, 0, "outside"), // 무환승이지만 운행 종료
    ];
    expect(selectTransitRoutes(routes).map((r) => r.routeKey)).not.toContain("p5");
  });

  it("후보가 5개 미만이면 있는 만큼만", () => {
    expect(selectTransitRoutes([route("p0", 20, 0), route("p1", 25, 0)])).toHaveLength(2);
  });

  it("경로가 하나면 그것만", () => {
    expect(selectTransitRoutes([route("p0", 20, 0)]).map((r) => r.routeKey)).toEqual(["p0"]);
  });

  it("1순위보다 나은 축이 없으면 정렬순으로만 채운다", () => {
    const routes = [route("p0", 10, 0), route("p1", 20, 0), route("p2", 30, 0)];
    expect(selectTransitRoutes(routes).map((r) => r.routeKey)).toEqual(["p0", "p1", "p2"]);
  });
});

describe("annotateHighlights", () => {
  it("1순위보다 빠르고 환승 적은 축에 라벨을 붙인다", () => {
    const result = annotateHighlights(
      [route("p0", 45, 1), route("p1", 71, 0), route("p2", 40, 1)],
      9,
    );
    expect(result.alternatives[0].highlight).toEqual(["fewestTransfers"]);
    expect(result.alternatives[1].highlight).toEqual(["fastest"]);
    expect(result.totalCandidates).toBe(9);
  });

  it("한 경로가 두 축을 모두 만족하면 둘 다 싣는다", () => {
    const result = annotateHighlights([route("p0", 45, 1), route("p1", 30, 0)], 5);
    expect(result.alternatives[0].highlight).toEqual(["fewestTransfers", "fastest"]);
  });

  it("축 없는 대안에만 1부터 표시 번호를 준다", () => {
    const result = annotateHighlights(
      [route("p0", 45, 1), route("p1", 71, 0), route("p2", 50, 1), route("p3", 52, 1)],
      9,
    );
    expect(result.alternatives[0].displayIndex).toBeUndefined(); // 축 경로
    expect(result.alternatives[1].displayIndex).toBe(1);
    expect(result.alternatives[2].displayIndex).toBe(2);
  });

  it("1순위가 이미 최단·최소환승이면 축 라벨이 없다", () => {
    const result = annotateHighlights([route("p0", 20, 0), route("p1", 30, 1)], 3);
    expect(result.alternatives[0].highlight).toBeUndefined();
    expect(result.alternatives[0].displayIndex).toBe(1);
  });

  it("운행 밖 경로에는 축 라벨을 주지 않는다", () => {
    // 접힌 disclosure의 접근명에는 운행 상태가 없어, 권할 수 없는 경로에
    // 권유 라벨이 붙으면 펼쳐야만 운행 종료를 안다(spec §2)
    const result = annotateHighlights([route("p0", 45, 1), route("p1", 30, 0, "outside")], 5);
    expect(result.alternatives[0].highlight).toBeUndefined();
    expect(result.alternatives[0].displayIndex).toBe(1);
  });

  it("강등이 1순위를 바꾼 뒤 축은 새 1순위 기준으로 계산된다", () => {
    // 강등 결과 p7(무환승 71분)이 1순위로 올라온 상태를 입력으로 준다.
    // 옛 1순위(p0 45분 환승1)는 이제 "가장 빠른 경로"여야 한다.
    const result = annotateHighlights([route("p7", 71, 0), route("p0", 45, 1)], 9);
    expect(result.recommended.routeKey).toBe("p7");
    expect(result.recommended.highlight).toBeUndefined(); // 1순위는 라벨을 갖지 않는다
    expect(result.alternatives[0].highlight).toEqual(["fastest"]);
  });
});
