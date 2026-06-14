import { describe, it, expect } from "vitest";
import { isStation, normalizeStationName } from "../station-match";

const place = (name: string, category: string) => ({
  id: "x",
  name,
  category,
  address: "",
  roadAddress: "",
  lat: 0,
  lng: 0,
});

describe("isStation", () => {
  it("카테고리에 지하철/철도/기차가 있으면 역", () => {
    expect(isStation(place("서울역", "교통,수송>지하철,전철"))).toBe(true);
    expect(isStation(place("행신역", "교통 > 기차"))).toBe(true);
  });
  it("이름이 역으로 끝나면 역", () => {
    expect(isStation(place("청량리역", "기타"))).toBe(true);
  });
  it("Station으로 끝나도 역(영문)", () => {
    expect(isStation(place("Seoul Station", "Transport > Subway"))).toBe(true);
  });
  it("음식점은 역 아님", () => {
    expect(isStation(place("역전국밥", "음식점>한식"))).toBe(false);
  });
});

describe("normalizeStationName", () => {
  it("접미사 역/station 제거 + 공백 정리", () => {
    expect(normalizeStationName("서울역")).toBe("서울");
    expect(normalizeStationName("Seoul Station")).toBe("seoul");
    expect(normalizeStationName("청량리역 ")).toBe("청량리");
  });
});
