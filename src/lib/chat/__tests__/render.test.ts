import { describe, it, expect } from "vitest";
import { placesToRender, placesSummary } from "../render";

const sample = [
  {
    id: "1",
    name: "길동 카페",
    category: "카페",
    address: "서울 강동구",
    roadAddress: "서울 강동구 길동로",
    lat: 37.5,
    lng: 127.1,
  },
  {
    id: "2",
    name: "길동 약국",
    category: "약국",
    address: "서울 강동구",
    roadAddress: "서울 강동구 길동로 2",
    lat: 37.5,
    lng: 127.1,
  },
] as any;

describe("placesToRender", () => {
  it("places를 RenderPayload로 투영", () => {
    expect(placesToRender(sample)).toEqual({ type: "places", places: sample });
  });
});

describe("placesSummary", () => {
  it("건수와 첫 항목명을 포함", () => {
    const s = placesSummary(sample, "ko");
    expect(s).toContain("2");
    expect(s).toContain("길동 카페");
  });
  it("빈 결과는 결과 없음 요약", () => {
    expect(placesSummary([], "ko")).toMatch(/없|0/);
  });
});
