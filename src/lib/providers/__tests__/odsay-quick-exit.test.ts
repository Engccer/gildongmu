import { describe, expect, it } from "vitest";
import { normalizeOdsayRoutes } from "../odsay";

/**
 * 빠른하차는 `passStopList`의 끝에서 두 번째 역(직전역)으로 방향을 가린다.
 * ⚠ `includeStops`는 **방출만** 통제한다 — 원본은 플래그와 무관하게 있으므로
 * 옵트인 없이 계산해 항상 싣는다(스펙 §5.2).
 */
const stops = (...names: string[]) => ({
  stations: names.map((stationName, i) => ({ stationName, x: `127.0${i}`, y: `37.5${i}` })),
});

/** 여의나루 → 여의도(5호선 상행). 상행 방면은 신길이라 하행이 배제된다. */
const SUBWAY = {
  pathType: 1,
  info: { totalTime: 20, payment: 1400, firstStartStation: "여의나루", lastEndStation: "여의도" },
  subPath: [
    { trafficType: 3, distance: 120, sectionTime: 2 },
    {
      trafficType: 1,
      distance: 1200,
      sectionTime: 3,
      startName: "마포",
      endName: "여의도",
      stationCount: 2,
      lane: [{ name: "수도권 5호선" }],
      wayCode: 1,
      passStopList: stops("마포", "여의나루", "여의도"),
    },
    { trafficType: 3, distance: 90, sectionTime: 2 },
  ],
};

const wrap = (paths: unknown[]) => ({ result: { path: paths } }) as never;
const legOf = (path: unknown, opts?: { includeStops?: boolean }) =>
  normalizeOdsayRoutes(wrap([path]), opts)![0].legs.find((l) => l.mode === "subway")!;

describe("odsay quickExit 부착", () => {
  it("지하철 leg에 quickExit를 싣는다", () => {
    expect(legOf(SUBWAY).quickExit).toEqual({
      elevator: { kind: "door", doors: ["6-4"] },
      stairs: { kind: "door", doors: ["5-4"] },
    });
  });

  it("includeStops=false여도 싣는다(방출만 통제하는 플래그)", () => {
    const leg = legOf(SUBWAY, { includeStops: false });
    expect(leg.stops).toBeUndefined();
    expect(leg.quickExit).toBeDefined();
  });

  it("버스·도보 leg에는 싣지 않는다", () => {
    const bus = {
      ...SUBWAY,
      subPath: [
        SUBWAY.subPath[0],
        { ...SUBWAY.subPath[1], trafficType: 2, lane: [{ busNo: "160" }] },
        SUBWAY.subPath[2],
      ],
    };
    const legs = normalizeOdsayRoutes(wrap([bus]))![0].legs;
    expect(legs.every((l) => l.quickExit === undefined)).toBe(true);
  });

  it("경유역이 1개 이하면 직전역을 모르므로 키를 만들지 않는다", () => {
    const short = {
      ...SUBWAY,
      subPath: [
        SUBWAY.subPath[0],
        { ...SUBWAY.subPath[1], passStopList: stops("여의도") },
        SUBWAY.subPath[2],
      ],
    };
    expect("quickExit" in legOf(short)).toBe(false);
  });

  it("경유역 마지막이 하차역과 다르면 목록을 신뢰하지 않는다", () => {
    // 순서가 뒤집혔거나 부분 목록이면 "끝에서 두 번째"가 직전역이 아니다.
    const reversed = {
      ...SUBWAY,
      subPath: [
        SUBWAY.subPath[0],
        { ...SUBWAY.subPath[1], passStopList: stops("여의도", "여의나루", "마포") },
        SUBWAY.subPath[2],
      ],
    };
    expect("quickExit" in legOf(reversed)).toBe(false);
  });

  it("판정 불가면 키 자체가 없다(byte-호환)", () => {
    const uncovered = {
      ...SUBWAY,
      subPath: [
        SUBWAY.subPath[0],
        {
          ...SUBWAY.subPath[1],
          endName: "노량진",
          lane: [{ name: "수도권 9호선" }],
          passStopList: stops("여의도", "샛강", "노량진"),
        },
        SUBWAY.subPath[2],
      ],
    };
    expect("quickExit" in legOf(uncovered)).toBe(false);
  });

  /** 사당 4호선(노원발, 하행) → 2호선 환승. seed 하행은 엘베 2-3·계단 1-1/5-2다(A20 리포트 자리). */
  const SADANG = {
    ...SUBWAY.subPath[1],
    startName: "노원",
    endName: "사당",
    lane: [{ name: "수도권 4호선" }],
    wayCode: 2,
    passStopList: stops("노원", "총신대입구", "사당"),
  };
  const LINE2 = {
    ...SUBWAY.subPath[1],
    startName: "사당",
    endName: "구로디지털단지",
    lane: [{ name: "수도권 2호선" }],
    passStopList: stops("사당", "신대방", "구로디지털단지"),
  };
  const legsOf = (subPath: unknown[]) =>
    normalizeOdsayRoutes(wrap([{ ...SUBWAY, subPath }]))![0].legs.filter((l) => l.mode === "subway");

  it("환승 leg는 ODsay door 하나만 싣고 seed 엘베·계단은 싣지 않는다(A20 배타)", () => {
    const [first, last] = legsOf([
      SUBWAY.subPath[0],
      { ...SADANG, door: "5-2" },
      { trafficType: 3, distance: 0, sectionTime: 3 },
      { ...LINE2, door: "null" },
      SUBWAY.subPath[2],
    ]);
    expect(first.quickExit).toEqual({ transfer: { kind: "door", doors: ["5-2"] } });
    // 최종 하차 leg는 종전대로 seed(구로디지털단지 2호선 하행).
    expect(last.quickExit?.transfer).toBeUndefined();
    expect(last.quickExit?.elevator ?? last.quickExit?.stairs).toBeDefined();
  });

  it('door "null" 문자열은 부재다 — 낭독 어디에도 "null"이 새지 않는다', () => {
    const legs = legsOf([SUBWAY.subPath[0], { ...SUBWAY.subPath[1], door: "null" }, SUBWAY.subPath[2]]);
    expect(JSON.stringify(legs)).not.toContain('"null"');
    expect(legs[0].quickExit?.transfer).toBeUndefined();
    expect(legs[0].quickExit?.elevator).toBeDefined();
  });

  it("2자리 칸 번호도 문이다(노원→서울역 환승 10-4 실관측)", () => {
    const legs = legsOf([SUBWAY.subPath[0], { ...SADANG, endName: "서울역", door: "10-4" }, SUBWAY.subPath[2]]);
    expect(legs[0].quickExit).toEqual({ transfer: { kind: "door", doors: ["10-4"] } });
  });

  it.each(["", "-", "5", "null", "5-2-1"])("door %j는 긍정 매칭 실패라 환승 문이 아니다", (door) => {
    const legs = legsOf([SUBWAY.subPath[0], { ...SUBWAY.subPath[1], door }, SUBWAY.subPath[2]]);
    expect(legs[0].quickExit?.transfer).toBeUndefined();
  });

  it("역내 환승(0m 도보 뒤 지하철)인데 door가 없으면 아무것도 싣지 않는다(거짓보다 침묵)", () => {
    const [first, last] = legsOf([
      SUBWAY.subPath[0],
      { ...SADANG, door: "null" },
      { trafficType: 3, distance: 0, sectionTime: 3 },
      { ...LINE2, door: "null" },
      SUBWAY.subPath[2],
    ]);
    expect("quickExit" in first).toBe(false);
    expect(last.quickExit).toBeDefined();
  });

  it("다음 탑승이 버스면 역을 나가므로 seed를 싣는다", () => {
    const [first] = legsOf([
      SUBWAY.subPath[0],
      { ...SADANG, door: "null" },
      { trafficType: 3, distance: 150, sectionTime: 2 },
      { ...SUBWAY.subPath[1], trafficType: 2, lane: [{ busNo: "5536" }] },
      SUBWAY.subPath[2],
    ]);
    expect(first.quickExit?.transfer).toBeUndefined();
    expect(first.quickExit?.elevator ?? first.quickExit?.stairs).toBeDefined();
  });

  it("역 밖 도보(0m 아님)를 끼고 다른 지하철로 가면 최종 하차로 본다", () => {
    const [first] = legsOf([
      SUBWAY.subPath[0],
      { ...SADANG, door: "null" },
      { trafficType: 3, distance: 300, sectionTime: 4 },
      { ...LINE2, door: "null" },
      SUBWAY.subPath[2],
    ]);
    expect(first.quickExit?.elevator ?? first.quickExit?.stairs).toBeDefined();
  });

  it("경유역이 없어도 다른 필드는 그대로다", () => {
    const noStops = {
      ...SUBWAY,
      subPath: [
        SUBWAY.subPath[0],
        { ...SUBWAY.subPath[1], passStopList: undefined },
        SUBWAY.subPath[2],
      ],
    };
    const leg = legOf(noStops);
    expect(leg).toMatchObject({ lineName: "수도권 5호선", toName: "여의도", stationCount: 2 });
    expect("quickExit" in leg).toBe(false);
  });
});

describe('transfer door "0-0"(실호출 2026-09-02, 같은 승강장 완행→급행 환승)', () => {
  it("0번 칸은 없으므로 문이 아니라 부재다", () => {
    const zero = {
      ...SUBWAY,
      subPath: [
        { ...SUBWAY.subPath[1], door: "0-0" },
        { trafficType: 3, distance: 0, sectionTime: 1 },
        { ...SUBWAY.subPath[1], startName: "여의도", endName: "신길", lane: [{ name: "수도권 5호선(급행)" }], door: "null" },
      ],
    };
    const legs = normalizeOdsayRoutes(wrap([zero]))![0].legs.filter((l) => l.mode === "subway");
    expect(legs[0].quickExit?.transfer).toBeUndefined();
    expect(JSON.stringify(legs)).not.toContain("0-0");
  });
});
