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
