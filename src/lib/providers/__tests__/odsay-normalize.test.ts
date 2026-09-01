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

/**
 * 출구 번호 투영(E25, spec `2026-09-02-express-stops-data-design.md` §4). 실호출 2026-09-02 개화→중앙보훈병원:
 * 첫 leg `startExitNo:"2"`, 마지막 leg `endExitNo:"1"`, 환승 leg엔 키 부재. 허용은 필드 존재가 아니라
 * 경로 문맥(역 밖 진입 승차·역 밖 하차)이다.
 */
describe("exit 투영(E25)", () => {
  const sub = (start: string, end: string, extra: Record<string, unknown>) => ({
    trafficType: 1,
    distance: 1000,
    sectionTime: 10,
    startName: start,
    endName: end,
    stationCount: 3,
    lane: [{ name: "수도권 9호선" }],
    wayCode: 1,
    ...extra,
  });
  const inStation = { trafficType: 3, distance: 0, sectionTime: 2 };
  const outside = { trafficType: 3, distance: 150, sectionTime: 2 };
  const P = (...subPath: unknown[]) => ({ pathType: 1, info: { totalTime: 30, payment: 1400 }, subPath });
  const legsOf = (path: unknown, includeStops = true) =>
    normalizeOdsayRoutes(wrap([path]), { includeStops })![0].legs.filter((l) => l.mode === "subway");

  it("첫 승차 leg의 board·마지막 하차 leg의 alight만 싣는다(환승 leg는 문맥으로 차단)", () => {
    const [a, b] = legsOf(
      P(
        outside,
        sub("개화", "김포공항", { startExitNo: "2", endExitNo: "7" }), // ODsay가 환승 하차 쪽에 값을 채워도
        inStation,
        sub("김포공항", "중앙보훈병원", { startExitNo: "5", endExitNo: "1" }), // 역내 환승 승차 쪽도
        outside,
      ),
    );
    expect(a.exit).toEqual({ board: "2" });
    expect(b.exit).toEqual({ alight: "1" });
  });

  it("버스로 갈아타는 하차·버스 뒤 승차는 역 밖이라 둘 다 허용된다", () => {
    const bus = { trafficType: 2, distance: 2000, sectionTime: 10, startName: "a", endName: "b", lane: [{ busNo: "1" }] };
    const [a, b] = legsOf(P(sub("x", "y", { endExitNo: "3" }), outside, bus, outside, sub("y", "z", { startExitNo: "4" })));
    expect(a.exit).toEqual({ alight: "3" });
    expect(b.exit).toEqual({ board: "4" });
  });

  it('"null"·빈 값·0 계열·앞자리 0은 부재, 둘 다 없으면 exit 키 자체 부재', () => {
    for (const bad of ["null", "", "0", "00", "2-0", "02", " ", "2abc"]) {
      const [l] = legsOf(P(sub("x", "y", { startExitNo: bad, endExitNo: bad })));
      expect("exit" in l).toBe(false);
    }
    const [ok] = legsOf(P(sub("x", "y", { startExitNo: " 2-1 ", endExitNo: "10" })));
    expect(ok.exit).toEqual({ board: "2-1", alight: "10" });
  });

  it("출구 좌표가 역에서 1km 밖이면 부재(좌표가 없으면 검사하지 않는다)", () => {
    const [far] = legsOf(P(sub("x", "y", { startExitNo: "2", startX: "127.00", startY: "37.50", startExitX: "127.05", startExitY: "37.50" })));
    expect("exit" in far).toBe(false);
    const [near] = legsOf(P(sub("x", "y", { startExitNo: "2", startX: "127.00", startY: "37.50", startExitX: "127.002", startExitY: "37.501" })));
    expect(near.exit).toEqual({ board: "2" });
  });

  it("includeStops 미지정이면 exit·expressStops 모두 부재(byte-호환)", () => {
    const [l] = legsOf(P(sub("x", "y", { startExitNo: "2", endExitNo: "1" })), false);
    expect("exit" in l).toBe(false);
    expect("expressStops" in l).toBe(false);
  });

  it("버스 leg에는 싣지 않는다", () => {
    const bus = { trafficType: 2, distance: 2000, sectionTime: 10, startName: "a", endName: "b", lane: [{ busNo: "1" }], startExitNo: "2" };
    const legs = normalizeOdsayRoutes(wrap([P(bus)]), { includeStops: true })![0].legs;
    expect("exit" in legs[0]).toBe(false);
  });
});
