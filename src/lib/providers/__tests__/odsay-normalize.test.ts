import { describe, expect, it } from "vitest";
import { normalizeOdsayRoutes } from "../odsay";

/** 자택 → 서울역 path[0] 실응답(2026-08-07 실호출) */
const SUBWAY_ONLY = {
  pathType: 1,
  info: { totalTime: 45, payment: 1750, firstStartStation: "길동", lastEndStation: "서울역" },
  subPath: [
    { trafficType: 3, distance: 178, sectionTime: 3 },
    {
      trafficType: 1,
      distance: 14200,
      sectionTime: 26,
      startName: "길동",
      endName: "동대문역사문화공원",
      stationCount: 13,
      lane: [{ name: "수도권 5호선" }],
      wayCode: 1,
    },
    { trafficType: 3, distance: 0, sectionTime: 3 },
    {
      trafficType: 1,
      distance: 3600,
      sectionTime: 7,
      startName: "동대문역사문화공원",
      endName: "서울역",
      stationCount: 4,
      lane: [{ name: "수도권 4호선" }],
      wayCode: 2,
    },
    { trafficType: 3, distance: 221, sectionTime: 3 },
  ],
};

/** 같은 응답 p6: 버스와 지하철 혼합(중간 도보가 버스 하차 → 지하철 승차) */
const MIXED = {
  pathType: 3,
  info: { totalTime: 62, payment: 1750, firstStartStation: "길동역1번출구", lastEndStation: "서울역" },
  subPath: [
    { trafficType: 3, distance: 182, sectionTime: 3 },
    {
      trafficType: 2,
      distance: 5000,
      sectionTime: 20,
      startName: "길동역1번출구",
      endName: "동대문구청.용두동주민센터",
      stationCount: 15,
      lane: [{ busNo: "130", busLocalBlID: "B1", busCityCode: 1000 }],
    },
    { trafficType: 3, distance: 371, sectionTime: 6 },
    {
      trafficType: 1,
      distance: 4000,
      sectionTime: 10,
      startName: "제기동",
      endName: "서울역",
      stationCount: 6,
      lane: [{ name: "수도권 1호선" }],
      wayCode: 2,
    },
    { trafficType: 3, distance: 198, sectionTime: 3 },
  ],
};

const wrap = (paths: unknown[]) => ({ result: { path: paths } }) as never;

describe("normalizeOdsayRoutes 도보 구간", () => {
  it("첫 도보의 행선지는 다음 탑승 구간의 승차역이다", () => {
    const legs = normalizeOdsayRoutes(wrap([SUBWAY_ONLY]))![0].legs;
    expect(legs[0]).toMatchObject({ mode: "walk", minutes: 3, distanceMeters: 178, toName: "길동" });
  });

  it("혼합 경로의 중간 도보는 다음 지하철 승차역을 가리킨다", () => {
    // 버스 하차지(동대문구청)에서 제기동역까지 371m 걷는 구간
    const legs = normalizeOdsayRoutes(wrap([MIXED]))![0].legs;
    const mid = legs.filter((l) => l.mode === "walk")[1];
    expect(mid).toMatchObject({ distanceMeters: 371, toName: "제기동" });
  });

  it("마지막 도보에는 행선지를 붙이지 않는다", () => {
    const legs = normalizeOdsayRoutes(wrap([SUBWAY_ONLY]))![0].legs;
    const last = legs[legs.length - 1];
    expect(last.mode).toBe("walk");
    expect(last.distanceMeters).toBe(221);
    expect(last.toName).toBeUndefined();
  });

  it("환승 통로(0m 도보)는 leg에서 빠지고 유도는 그 뒤 배열에서 돈다", () => {
    const legs = normalizeOdsayRoutes(wrap([SUBWAY_ONLY]))![0].legs;
    expect(legs.filter((l) => l.mode === "walk")).toHaveLength(2);
    // 0m 도보가 남아 있었다면 첫 도보의 toName이 "동대문역사문화공원"이 됐을 것
    expect(legs[0].toName).toBe("길동");
  });

  it("거리가 없거나 비수치면 필드를 싣지 않는다(3-state)", () => {
    const noDist = {
      ...SUBWAY_ONLY,
      subPath: [{ trafficType: 3, sectionTime: 3 }, ...SUBWAY_ONLY.subPath.slice(1)],
    };
    const bad = {
      ...SUBWAY_ONLY,
      subPath: [{ trafficType: 3, distance: -1, sectionTime: 3 }, ...SUBWAY_ONLY.subPath.slice(1)],
    };
    expect(normalizeOdsayRoutes(wrap([noDist]))![0].legs[0].distanceMeters).toBeUndefined();
    expect(normalizeOdsayRoutes(wrap([bad]))![0].legs[0].distanceMeters).toBeUndefined();
  });

  it("탑승 구간에는 거리를 싣지 않는다", () => {
    const legs = normalizeOdsayRoutes(wrap([SUBWAY_ONLY]))![0].legs;
    expect(legs.find((l) => l.mode === "subway")!.distanceMeters).toBeUndefined();
  });
});

describe("normalizeOdsayRoutes 봉투 3-state", () => {
  it("전체 경로를 정규화하고 routeKey를 원본 순서로 부여한다", () => {
    const routes = normalizeOdsayRoutes(wrap([SUBWAY_ONLY, MIXED]))!;
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.routeKey)).toEqual(["p0", "p1"]);
  });

  it("경로 없음 코드는 null(graceful)", () => {
    expect(normalizeOdsayRoutes({ error: { code: "-98", msg: "x" } } as never)).toBeNull();
  });

  it("배열 봉투의 인증 실패는 throw", () => {
    expect(() =>
      normalizeOdsayRoutes({ error: [{ code: "500", message: "[ApiKeyAuthFailed]" }] } as never),
    ).toThrow(/ODsay/);
  });

  it("path가 빈 배열이면 null(진짜 0건)", () => {
    expect(normalizeOdsayRoutes(wrap([]))).toBeNull();
  });

  it("result나 path가 없으면 throw (조회 실패를 0건으로 뭉개지 않는다)", () => {
    expect(() => normalizeOdsayRoutes({} as never)).toThrow(/스키마/);
    expect(() => normalizeOdsayRoutes({ result: {} } as never)).toThrow(/스키마/);
  });
});
