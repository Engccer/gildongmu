import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { displayStationName, exitQueryStationName } from "../display";

/** 웹 ↔ Kit `journeyStationDisplayName` 공유 사례(같은 fixture를 Kit `JourneyTests`가 읽는다). */
const { cases } = JSON.parse(readFileSync("src/lib/__tests__/fixtures/journey-display-names.json", "utf8")) as {
  cases: Array<{ input: string; expected: string }>;
};

describe("displayStationName", () => {
  it.each(cases.map((c) => [c.input, c.expected]))("%s → %s", (input, expected) => {
    expect(displayStationName(input)).toBe(expected);
  });
});

describe("exitQueryStationName — 카카오 출구 질의 이름", () => {
  it("괄호 부기까지 뗀다(표시 이름과 다른 점 — 남기면 질의가 0건이라 「출구 없음」으로 위장한다)", () => {
    expect(exitQueryStationName("하남시청(덕풍.신장)")).toBe("하남시청");
    expect(exitQueryStationName("총신대입구(이수)")).toBe("총신대입구");
    expect(displayStationName("총신대입구(이수)")).toBe("총신대입구(이수)");
  });
  it("「역」·노선 토큰을 뗀다(「서울역역」 질의 금지)", () => {
    expect(exitQueryStationName("서울역")).toBe("서울");
    expect(exitQueryStationName("아현역 2호선")).toBe("아현");
  });
});
