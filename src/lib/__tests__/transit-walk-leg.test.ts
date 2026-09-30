import { describe, expect, it } from "vitest";
import fixture from "./fixtures/transit-walk-destination-cases.json";
import { transitWalkDestinationName, transitWalkLegMessage } from "../transit-walk-leg";
import type { TransitLeg } from "../types";

// A52 — 마지막 도보 줄의 목적지 이름. 규칙표는 Kit·안드로이드 :kit과 공유한다.
describe("transitWalkDestinationName — 공유 fixture", () => {
  it("fixture가 비지 않았다", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
  });
  it.each(fixture.cases)("$id", (c) => {
    expect(transitWalkDestinationName(c.label, c.roman, c.english)).toBe(c.expected);
  });
});

describe("transitWalkLegMessage", () => {
  const subway: TransitLeg = {
    mode: "subway",
    lineName: "수도권 5호선",
    lineNameEn: "Line 5",
    fromName: "여의도",
    fromNameEn: "Yeouido",
    toName: "여의나루",
    toNameEn: "Yeouinaru",
    stationCount: 1,
    minutes: 2,
  };
  const lastWalk: TransitLeg = { mode: "walk", minutes: 4, distanceMeters: 242 };

  it("en 세션의 마지막 도보는 한글 목적지 이름을 싣지 않는다(재현: 'to 63빌딩')", () => {
    const m = transitWalkLegMessage([subway, lastWalk], 1, { label: "63빌딩", roman: null }, true);
    expect(m.key).toBe("legWalkToDest");
    expect(m.values).toEqual({ minutes: 4, distance: "242m" });
  });

  it("en 세션에 라틴 표기가 있으면 그 이름을 싣는다(병기 괄호 없음)", () => {
    const m = transitWalkLegMessage([subway, lastWalk], 1, { label: "63빌딩", roman: "63bilding" }, true);
    expect(m.key).toBe("legWalkTo");
    expect(m.values).toEqual({ minutes: 4, name: "63bilding", distance: "242m" });
  });

  it("ko 세션은 목적지 원명 그대로", () => {
    const m = transitWalkLegMessage([subway, lastWalk], 1, { label: "63빌딩", roman: "63bilding" }, false);
    expect(m.values.name).toBe("63빌딩");
  });

  it("행선지가 있는 도보는 영어 줄이면 영문 행선지, 승차 출구를 싣는다", () => {
    const walk: TransitLeg = { mode: "walk", minutes: 3, toName: "여의도", toNameEn: "Yeouido", distanceMeters: 98 };
    const withExit: TransitLeg = { ...subway, exit: { board: "3" } };
    const en = transitWalkLegMessage([walk, withExit], 0, { label: "63빌딩", roman: null }, true);
    expect(en).toEqual({ key: "legWalkToExit", values: { minutes: 3, name: "Yeouido", distance: "98m", exit: "3" } });
    expect(transitWalkLegMessage([walk, withExit], 0, { label: null, roman: null }, false).values.name).toBe("여의도");
  });

  it("거리가 없으면 거리 없는 문구(3-state)", () => {
    const m = transitWalkLegMessage([subway, { mode: "walk", minutes: 1 }], 1, { label: null, roman: null }, true);
    expect(m).toEqual({ key: "legWalkToDestNoDistance", values: { minutes: 1 } });
  });
});
