import { describe, expect, it } from "vitest";
import { displayStationName } from "../display";

describe("displayStationName", () => {
  it("끝 「역」 한 글자를 뗀다(서울역역 방지)", () => {
    expect(displayStationName("서울역")).toBe("서울");
  });
  it("「역」이 없으면 그대로", () => {
    expect(displayStationName("아현")).toBe("아현");
  });
  it("이름이 「역」 하나면 유지한다", () => {
    expect(displayStationName("역")).toBe("역");
  });
  it("괄호 부기는 유지한다", () => {
    expect(displayStationName("천호(풍납토성)역")).toBe("천호(풍납토성)");
  });
  it("후행 노선 토큰을 뗀다", () => {
    expect(displayStationName("아현역 2호선")).toBe("아현");
    expect(displayStationName("신촌역 경의중앙선")).toBe("신촌");
  });
  it("앞뒤 공백을 무시한다", () => {
    expect(displayStationName("  서울역 ")).toBe("서울");
  });
});
