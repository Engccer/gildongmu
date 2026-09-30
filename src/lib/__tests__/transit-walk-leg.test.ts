import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    const m = transitWalkLegMessage([subway, lastWalk], 1, {
      stationNamesEn: true,
      destination: transitWalkDestinationName("63빌딩", null, true),
    });
    expect(m.key).toBe("legWalkToDest");
    expect(m.values).toEqual({ minutes: 4, distance: "242m" });
  });

  it("en 세션에 라틴 표기가 있으면 그 이름을 싣는다(병기 괄호 없음)", () => {
    const m = transitWalkLegMessage([subway, lastWalk], 1, {
      stationNamesEn: true,
      destination: transitWalkDestinationName("63빌딩", "63bilding", true),
    });
    expect(m.key).toBe("legWalkTo");
    expect(m.values).toEqual({ minutes: 4, name: "63bilding", distance: "242m" });
  });

  it("ko 세션은 목적지 원명 그대로", () => {
    const m = transitWalkLegMessage([subway, lastWalk], 1, {
      stationNamesEn: false,
      destination: transitWalkDestinationName("63빌딩", "63bilding", false),
    });
    expect(m.values.name).toBe("63빌딩");
  });

  it("행선지가 있는 도보는 영어 줄이면 영문 행선지, 승차 출구를 싣는다", () => {
    const walk: TransitLeg = { mode: "walk", minutes: 3, toName: "여의도", toNameEn: "Yeouido", distanceMeters: 98 };
    const withExit: TransitLeg = { ...subway, exit: { board: "3" } };
    const en = transitWalkLegMessage([walk, withExit], 0, { stationNamesEn: true, destination: null });
    expect(en).toEqual({ key: "legWalkToExit", values: { minutes: 3, name: "Yeouido", distance: "98m", exit: "3" } });
    // 탑승 줄이 한국어 역명이면 도보 줄도 한국어 역명(같은 역을 두 이름으로 부르지 않는다).
    expect(transitWalkLegMessage([walk, withExit], 0, { stationNamesEn: false, destination: "63bilding" }).values.name).toBe("여의도");
  });

  it("거리가 없으면 거리 없는 문구(3-state)", () => {
    const m = transitWalkLegMessage([subway, { mode: "walk", minutes: 1 }], 1, { stationNamesEn: true, destination: null });
    expect(m).toEqual({ key: "legWalkToDestNoDistance", values: { minutes: 1 } });
  });
});

// 화면·WebMCP 두 소비자의 배선. 컴포넌트 렌더 테스트는 화면(TransitEnglish.test.tsx)만 en을 본다 — WebMCP 투영은
// ko 목 번역기 파일에 있어 en 렌더가 없으므로, 목적지 폴백이 영어 판정을 지나는지를 소스로 잠근다.
describe("도보 줄 소비자 배선(A52)", () => {
  const read = (f: string) => readFileSync(join(__dirname, "../../components", f), "utf8");
  it("WebMCP 투영: 역 이름은 탑승 줄과 같은 한국어, 목적지는 영어 판정을 지난다", () => {
    const src = read("DirectionsView.tsx");
    expect(src).toMatch(
      /transitWalkLegMessage\(legs, index, \{\s*stationNamesEn: false,\s*destination: transitWalkDestinationName\(destName, null, prefersEnglish\(locale\)\),/,
    );
  });
  it("화면 브리핑: 역 이름과 목적지 모두 같은 영어 판정", () => {
    const src = read("TransitRouteBriefing.tsx");
    expect(src).toMatch(
      /transitWalkLegMessage\(route\.legs, i, \{\s*stationNamesEn: isEn,\s*destination: transitWalkDestinationName\(dest, null, isEn\),/,
    );
  });
});
