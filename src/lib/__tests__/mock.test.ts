import { describe, it, expect } from "vitest";
import { searchPlacesMock } from "../providers/mock";

describe("searchPlacesMock", () => {
  it("이름 부분 일치로 검색된다", async () => {
    const result = await searchPlacesMock({ query: "경복궁" });
    expect(result.provider).toBe("mock");
    expect(result.places.some((p) => p.name === "경복궁")).toBe(true);
  });

  it("일치가 없으면 전체 목록을 돌려준다 (빈 화면 방지)", async () => {
    const result = await searchPlacesMock({ query: "존재하지않는장소xyz" });
    expect(result.places.length).toBeGreaterThan(0);
  });

  it("limit을 준수한다", async () => {
    const result = await searchPlacesMock({ query: "서울", limit: 2 });
    expect(result.places.length).toBeLessThanOrEqual(2);
  });

  it("모든 mock 좌표는 WGS84 한반도 권역이다", async () => {
    const result = await searchPlacesMock({ query: "" });
    for (const p of result.places) {
      expect(p.lat).toBeGreaterThan(33);
      expect(p.lat).toBeLessThan(39);
      expect(p.lng).toBeGreaterThan(124);
      expect(p.lng).toBeLessThan(132);
    }
  });
});
