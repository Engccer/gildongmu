import { readFileSync, readdirSync } from "node:fs";
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
  const en = (destinationLabel: string | null, destinationRoman: string | null = null) => ({
    english: true,
    destinationLabel,
    destinationRoman,
  });

  it("en 세션의 마지막 도보는 한글 목적지 이름을 싣지 않는다(재현: 'to 63빌딩')", () => {
    const m = transitWalkLegMessage([subway, lastWalk], 1, en("63빌딩"));
    expect(m.key).toBe("legWalkToDest");
    expect(m.values).toEqual({ minutes: 4, distance: "242m" });
  });

  it("en 세션에 끝점 라틴 표기가 있으면 그 이름을 싣는다(병기 괄호 없음, A53 ①)", () => {
    const m = transitWalkLegMessage([subway, lastWalk], 1, en("63빌딩", "63bilding"));
    expect(m).toEqual({ key: "legWalkTo", values: { minutes: 4, name: "63bilding", distance: "242m" }, english: true });
  });

  it("ko 세션은 목적지 원명 그대로(로마자가 있어도)", () => {
    const m = transitWalkLegMessage([subway, lastWalk], 1, {
      english: false,
      destinationLabel: "63빌딩",
      destinationRoman: "63bilding",
    });
    expect(m.values.name).toBe("63빌딩");
    expect(m.english).toBe(false);
  });

  it("행선지가 있는 도보는 영문 행선지와 승차 출구를 싣는다", () => {
    const walk: TransitLeg = { mode: "walk", minutes: 3, toName: "여의도", toNameEn: "Yeouido", distanceMeters: 98 };
    const withExit: TransitLeg = { ...subway, exit: { board: "3" } };
    expect(transitWalkLegMessage([walk, withExit], 0, en("63빌딩", "63bilding"))).toEqual({
      key: "legWalkToExit",
      values: { minutes: 3, name: "Yeouido", distance: "98m", exit: "3" },
      english: true,
    });
  });

  it("영문 행선지가 없는 중간 도보는 그 줄의 이름이 한국어다(Kit `transitLegUsesEnglish` 동형, A53 ②)", () => {
    // Kit·안드로이드도 이 줄을 "Walk 3 min to 여의도, 98m"로 낸다(문장 틀은 UI 언어, 이름만 한국어).
    // 반환 english=false가 화면이 그 이름에 lang="ko"를 다는 근거다. 목적지로 새지 않는다.
    const walk: TransitLeg = { mode: "walk", minutes: 3, toName: "여의도", distanceMeters: 98 };
    const board: TransitLeg = { ...subway, fromNameEn: undefined };
    expect(transitWalkLegMessage([walk, board], 0, en("63빌딩", "63bilding"))).toEqual({
      key: "legWalkTo",
      values: { minutes: 3, name: "여의도", distance: "98m" },
      english: false,
    });
  });

  it("빈 행선지는 부재라 목적지로 떨어지고 영어 줄이다", () => {
    const m = transitWalkLegMessage([subway, { mode: "walk", minutes: 1, toName: " \t" }], 1, en("Lotte World Tower"));
    expect(m).toEqual({ key: "legWalkToNoDistance", values: { minutes: 1, name: "Lotte World Tower" }, english: true });
  });

  it("거리가 없으면 거리 없는 문구(3-state)", () => {
    const m = transitWalkLegMessage([subway, { mode: "walk", minutes: 1 }], 1, en(null));
    expect(m).toEqual({ key: "legWalkToDestNoDistance", values: { minutes: 1 }, english: true });
  });
});

// 화면·WebMCP 두 소비자의 배선. 컴포넌트 렌더 테스트는 화면(TransitEnglish.test.tsx)이 en을 보고, WebMCP 투영의 en은
// DirectionsWebMcp.en.test.tsx가 본다. 여기서는 두 소비자가 **같은 인자**(데이터 언어·끝점 라벨·라틴 표기)로 같은 함수를
// 부르는지를 소스로 잠근다 — 한쪽만 줄 단위 판정에서 벗어나면 같은 경로를 화면과 도구가 다른 말로 부른다(A53).
describe("도보·탑승 줄 소비자 배선(A52·A53)", () => {
  const read = (f: string) => readFileSync(join(__dirname, "../../components", f), "utf8");
  it("WebMCP 투영: 도보는 화면과 같은 인자, 탑승은 화면과 같은 이름 선택", () => {
    const src = read("DirectionsView.tsx");
    expect(src).toMatch(
      /transitWalkLegMessage\(legs, index, \{\s*english,\s*destinationLabel: dest\.label,\s*destinationRoman: dest\.roman,\s*\}\)/,
    );
    expect(src).toMatch(/const names = transitBoardLegNames\(leg, english\);/);
    expect(src).toMatch(/destRoman=\{results\.destRoman\}/);
  });
  it("화면 브리핑: 도보는 데이터 언어·끝점 라틴 표기, 탑승은 같은 이름 선택", () => {
    const src = read("TransitRouteBriefing.tsx");
    expect(src).toMatch(
      /transitWalkLegMessage\(route\.legs, i, \{\s*english: isEn,\s*destinationLabel: dest,\s*destinationRoman: destRoman,\s*\}\)/,
    );
    expect(src).toMatch(/const names = transitBoardLegNames\(leg, isEn\);/);
  });
});

// 화면은 이름 자리를 표식으로 찾아 그 이름에만 lang="ko"를 단다(`TransitRouteBriefing` `NAME_SLOT`) — 번역문이 `{name}`을
// 두 번 쓰거나 빠뜨리면 문장 꼬리가 조용히 잘린다. 이름을 싣는 네 키는 모든 로케일에서 `{name}`이 정확히 한 번이다.
describe("도보 줄 이름 자리(A53 ②)", () => {
  const dir = join(__dirname, "../../../messages");
  const locales = readdirSync(dir).filter((f) => f.endsWith(".json"));
  it("6로케일", () => expect(locales).toHaveLength(6));
  it.each(locales)("%s", (file) => {
    const transit = JSON.parse(readFileSync(join(dir, file), "utf8")).route.transit as Record<string, string>;
    for (const key of ["legWalkTo", "legWalkToNoDistance", "legWalkToExit", "legWalkToExitNoDistance"]) {
      expect(transit[key].split("{name}").length - 1, `${file} ${key}`).toBe(1);
    }
  });
});
