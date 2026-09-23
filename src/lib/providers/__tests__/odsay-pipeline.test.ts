import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

/**
 * 테스트가 채우는 운행시간 표. 비어 있으면 전 구간 unknown이라 강등 정렬이
 * no-op이 된다. ⚠ 그 상태로만 검증하면 "라벨을 강등 앞에서 붙인다"는 변이가
 * 통과한다(순서가 안 바뀌니 결과가 같다). 순서를 실제로 뒤집는 케이스가 있어야
 * 파이프라인 순서 계약이 검증된다.
 */
const busHours = new Map<string, { firstMinutes: number; lastMinutes: number }>();
vi.mock("../bus-service-hours", () => ({
  fetchServiceHoursMap: vi.fn(async () => busHours),
}));
vi.mock("../subway-service-hours", () => ({
  fetchSubwayServiceHoursMap: vi.fn(async () => new Map()),
  subwayHoursKey: (r: { stationName: string; lineName: string; wayCode: number }) =>
    `${r.stationName}|${r.lineName}|${r.wayCode}`,
}));

import { getTransitRoute } from "../odsay";

/** ⚠ 화살표 한 줄로 쓰면 mock 자체가 반환되어 teardown으로 등록된다(중괄호 필수) */
beforeEach(() => {
  fetchMock.mockReset();
  busHours.clear();
});

function subwayOnlyPath(minutes: number) {
  return {
    pathType: 1,
    info: { totalTime: minutes, payment: 1550, totalWalk: 300 },
    subPath: [
      { trafficType: 3, distance: 100, sectionTime: 2 },
      { trafficType: 1, distance: 5000, sectionTime: minutes, stationCount: 5, startName: "갑", endName: "을", lane: [{ name: "수도권 5호선" }] },
      { trafficType: 3, distance: 200, sectionTime: 3 },
    ],
  };
}

function busPath(minutes: number, boards: number, routeId?: string) {
  const subPath: unknown[] = [{ trafficType: 3, distance: 100, sectionTime: 2 }];
  for (let i = 0; i < boards; i++) {
    subPath.push({
      trafficType: 2,
      distance: 1000,
      sectionTime: minutes,
      stationCount: 5,
      startName: `승차${i}`,
      endName: `하차${i}`,
      lane: [
        { busNo: `${100 + i}`, busLocalBlID: routeId ?? `B${i}`, busCityCode: 1000 },
      ],
    });
    if (i < boards - 1) subPath.push({ trafficType: 3, distance: 50, sectionTime: 1 });
  }
  subPath.push({ trafficType: 3, distance: 200, sectionTime: 3 });
  return { pathType: 2, info: { totalTime: minutes, payment: 1500 }, subPath };
}

function respond(paths: unknown[]) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ result: { path: paths } }),
  });
}

const COORDS = { origin: { lat: 37.5, lng: 127.1 }, dest: { lat: 37.55, lng: 126.97 } };

describe("getTransitRoute 파이프라인", () => {
  it("이유 없는 경로는 번호로 채우지 않고 후보 총수를 보존한다(E50 판정 1)", async () => {
    respond(Array.from({ length: 9 }, (_, i) => busPath(20 + i, 1)));
    const result = (await getTransitRoute(COORDS))!;
    expect(result.alternatives).toHaveLength(0);
    expect(result.totalCandidates).toBe(9);
    // 1순위가 버스만이라 지하철만 재조회만 제안한다
    expect(result.requeryAxes).toEqual(["subwayOnly"]);
  });

  it("도보 거리는 totalWalk이고 유한한 0 이상 수가 아니면 싣지 않는다", async () => {
    const withWalk = { ...busPath(20, 1), info: { totalTime: 20, payment: 1500, totalWalk: 412 } };
    const bogus = { ...busPath(21, 1), info: { totalTime: 21, payment: 1500, totalWalk: -1 } };
    respond([withWalk, bogus]);
    const result = (await getTransitRoute(COORDS))!;
    expect(result.recommended.summary.walkMeters).toBe(412);
    respond([bogus]);
    expect("walkMeters" in (await getTransitRoute(COORDS))!.recommended.summary).toBe(false);
  });

  it("수단은 pathType과 구간 구성이 둘 다 맞을 때만 싣는다", async () => {
    const lying = { ...busPath(30, 1), pathType: 1 }; // pathType은 지하철인데 구간은 버스
    // pathType은 지하철인데 구간이 지하철+버스로 섞였다 — 한쪽만 맞아도 "지하철만"이 아니다
    const sub = subwayOnlyPath(35);
    const mixed = { ...sub, subPath: [...sub.subPath, ...busPath(5, 1).subPath] };
    respond([subwayOnlyPath(20), busPath(25, 1), lying, mixed]);
    const all = (await getTransitRoute({ ...COORDS, modeAxis: "subwayOnly" }))!;
    expect(all.totalCandidates).toBe(1); // 지하철만 필터를 지나는 것은 첫 경로 하나뿐
    respond([subwayOnlyPath(20), busPath(25, 1), lying]);
    const result = (await getTransitRoute(COORDS))!;
    expect(result.recommended.vehicle).toBe("subway");
    const bus = result.alternatives.find((a) => a.highlight?.includes("busOnly"));
    expect(bus?.vehicle).toBe("bus");
    expect(result.requeryAxes).toBeUndefined();
  });

  describe("수단 재조회(modeAxis)", () => {
    it("SearchPathType을 붙이고, 그 수단의 1순위 하나만 접두 키로 돌려준다", async () => {
      respond([subwayOnlyPath(30), busPath(40, 1), busPath(35, 1)]);
      const result = (await getTransitRoute({ ...COORDS, modeAxis: "busOnly" }))!;
      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain("SearchPathType=2");
      expect(result.recommended.vehicle).toBe("bus");
      expect(result.recommended.routeKey).toBe("b1");
      expect(result.alternatives).toEqual([]);
      expect(result.requeryAxes).toBeUndefined();
    });

    it("지하철은 SearchPathType=1·접두 s", async () => {
      respond([subwayOnlyPath(30)]);
      const result = (await getTransitRoute({ ...COORDS, modeAxis: "subwayOnly" }))!;
      expect(String(fetchMock.mock.calls[0][0])).toContain("SearchPathType=1");
      expect(result.recommended.routeKey).toBe("s0");
    });

    it("그 수단만 타는 경로가 걸러져 없으면 null(없음)", async () => {
      respond([subwayOnlyPath(30)]);
      expect(await getTransitRoute({ ...COORDS, modeAxis: "busOnly" })).toBeNull();
    });

    it("본 조회 URL에는 SearchPathType이 없다(캐시 키 불변)", async () => {
      respond([busPath(20, 1)]);
      await getTransitRoute(COORDS);
      expect(String(fetchMock.mock.calls[0][0])).not.toContain("SearchPathType");
    });
  });

  it("무환승 경로가 뒤에 있어도 대안에 오른다", async () => {
    const paths = [
      busPath(20, 2),
      busPath(22, 2),
      busPath(23, 2),
      busPath(24, 2),
      busPath(25, 2),
      busPath(26, 2),
      busPath(40, 1), // 무환승, 7번째
    ];
    respond(paths);
    const result = (await getTransitRoute(COORDS))!;
    const labeled = result.alternatives.find((r) => r.highlight?.includes("fewestTransfers"));
    expect(labeled?.summary.transfers).toBe(0);
  });

  it("도보 구간의 행선지와 거리가 최종 응답까지 살아 있다", async () => {
    respond([busPath(20, 1)]);
    const result = (await getTransitRoute(COORDS))!;
    const [firstWalk, , lastWalk] = result.recommended.legs;
    expect(firstWalk).toMatchObject({ mode: "walk", distanceMeters: 100, toName: "승차0" });
    expect(lastWalk).toMatchObject({ mode: "walk", distanceMeters: 200 });
    expect(lastWalk.toName).toBeUndefined();
  });

  it("스키마 위반은 throw (0건으로 뭉개지 않는다)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(getTransitRoute(COORDS)).rejects.toThrow(/스키마/);
  });

  it("경로 없음은 null", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: { code: "-98", msg: "x" } }),
    });
    expect(await getTransitRoute(COORDS)).toBeNull();
  });

  it("강등이 1순위를 바꾸면 축은 새 1순위 기준으로 계산된다", async () => {
    // 이 케이스가 파이프라인 **순서** 계약의 정본이다. 시간표가 비어 전 구간이
    // unknown이면 강등 정렬이 no-op이라, 라벨을 강등 앞에서 붙여도 결과가 같아
    // 순서 위반이 통과한다. 여기서는 강등이 실제로 1순위를 뒤집는다.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-08-06T16:00:00Z")); // 01:00 KST
      busHours.set("DAY", { firstMinutes: 240, lastMinutes: 1350 }); // 04:00~22:30 → outside
      busHours.set("NIGHT", { firstMinutes: 1390, lastMinutes: 230 }); // 23:10~03:50 → running
      respond([
        busPath(40, 2, "DAY"), // ODsay 추천 1순위지만 운행 종료
        busPath(60, 1, "NIGHT"), // 느리고 무환승이며 운행 중
      ]);

      const result = (await getTransitRoute(COORDS))!;

      // 강등이 운행 중 경로를 1순위로 올렸다(이 단언이 깨지면 아래가 무의미하다)
      expect(result.recommended.routeKey).toBe("p1");
      // ⚠ 1순위는 축 라벨을 갖지 않는다. 라벨을 강등 앞에서 붙이면 p1이 옛 1순위
      //   기준으로 "환승이 가장 적은 경로" 라벨을 받은 채 승격돼 이 단언이 깨진다.
      expect(result.recommended.highlight).toBeUndefined();
      // 강등된 옛 1순위는 운행 밖이라 축 후보에서 빠지고, 이유 없는 대안은 싣지 않는다(E50)
      expect(result.alternatives.map((a) => a.routeKey)).not.toContain("p0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("배열 봉투 인증 실패는 throw (경로 없음으로 오분류하지 않는다)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: [{ code: "500", message: "[ApiKeyAuthFailed]" }] }),
    });
    await expect(getTransitRoute(COORDS)).rejects.toThrow(/ODsay/);
  });
});

/**
 * 급행 정차역 부착(A16 L1, spec `2026-09-02-express-stops-data-design.md` §3.4) — 조회는 스텁, 부착 경계만 본다.
 * ⚠ 이 스위트가 실호출 스텁 없이 돌면 `odsay-express-stops`가 실제 fetch(위 fetchMock)를 타 첫 mock 응답을 되읽는다.
 */
const expressSets = new Map<string, { names: string[]; ids: string[] }>();
vi.mock("../odsay-express-stops", () => ({
  fetchExpressStopsMap: vi.fn(async () => expressSets),
}));
const SET3 = { names: ["김포공항", "당산", "중앙보훈병원"], ids: ["902", "913", "938"] };

function subwayPath(...lanes: string[]) {
  const subPath: unknown[] = [{ trafficType: 3, distance: 100, sectionTime: 2 }];
  lanes.forEach((name, i) => {
    if (i > 0) subPath.push({ trafficType: 3, distance: 0, sectionTime: 1 });
    subPath.push({
      trafficType: 1,
      distance: 3000,
      sectionTime: 8,
      stationCount: 4,
      startName: `승차${i}`,
      endName: `하차${i}`,
      lane: [{ name }],
      wayCode: 1,
      passStopList: { stations: [{ stationName: `승차${i}`, x: "127.0", y: "37.5" }, { stationName: `하차${i}`, x: "127.1", y: "37.6" }] },
    });
  });
  subPath.push({ trafficType: 3, distance: 200, sectionTime: 3 });
  return { pathType: 1, info: { totalTime: 30, payment: 1500 }, subPath };
}

describe("expressStops 부착", () => {
  beforeEach(() => {
    expressSets.clear();
  });

  it("includeStops면 표 노선 leg(완행·급행)에 붙고 다른 노선엔 없다 — 조회 인자는 표 노선 dedupe", async () => {
    const { fetchExpressStopsMap } = await import("../odsay-express-stops");
    const { EXPRESS_LINES } = await import("../../express-stops");
    vi.mocked(fetchExpressStopsMap).mockClear();
    expressSets.set("수도권 9호선", SET3);
    respond([subwayPath("수도권 9호선", "수도권 9호선(급행)", "수도권 5호선")]);
    const result = (await getTransitRoute({ ...COORDS, includeStops: true }))!;
    const subways = result.recommended.legs.filter((l) => l.mode === "subway");
    expect(subways.map((l) => l.expressStops)).toEqual([SET3.names, SET3.names, undefined]);
    expect(subways.map((l) => l.expressStopIds)).toEqual([SET3.ids, SET3.ids, undefined]);
    // ⚠ 인자를 단언하지 않으면 `expressLinesIn`이 빈 배열을 내는 회귀가 통과한다(프로덕션에선 필드 부재 = 반증 채널 0)
    expect(fetchExpressStopsMap).toHaveBeenCalledWith([EXPRESS_LINES.find((e) => e.line === "수도권 9호선")]);
  });

  it("includeStops가 아니면 조회조차 하지 않고 필드도 없다", async () => {
    const { fetchExpressStopsMap } = await import("../odsay-express-stops");
    vi.mocked(fetchExpressStopsMap).mockClear();
    expressSets.set("수도권 9호선", SET3);
    respond([subwayPath("수도권 9호선")]);
    const result = (await getTransitRoute(COORDS))!;
    expect(fetchExpressStopsMap).not.toHaveBeenCalled();
    expect("expressStops" in result.recommended.legs[1]).toBe(false);
  });

  it("조회가 빈손이면 부재이고 경로 응답은 그대로다", async () => {
    respond([subwayPath("수도권 9호선")]);
    const result = (await getTransitRoute({ ...COORDS, includeStops: true }))!;
    expect(result.recommended.legs.filter((l) => l.mode === "subway")).toHaveLength(1);
    expect("expressStops" in result.recommended.legs[1]).toBe(false);
  });
});
