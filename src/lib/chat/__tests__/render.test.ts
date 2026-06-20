import { describe, it, expect } from "vitest";
import { placesToRender, placesSummary, addressesToRender, addressesSummary } from "../render";
import type { JusoAddress } from "@/lib/types";

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

const addressSample: JusoAddress[] = [
  {
    roadAddr: "서울특별시 중구 세종대로 110 (태평로1가)",
    roadAddrPart1: "서울특별시 중구 세종대로 110",
    jibunAddr: "서울특별시 중구 태평로1가 31",
    engAddr: "110 Sejong-daero, Jung-gu, Seoul",
    zipNo: "04524",
    bdNm: "서울특별시청",
  },
];

describe("addressesToRender", () => {
  it("addresses를 RenderPayload로 투영", () => {
    expect(addressesToRender(addressSample)).toEqual({
      type: "addresses",
      results: addressSample,
    });
  });
});

describe("addressesSummary", () => {
  it("건수와 첫 roadAddr를 포함", () => {
    const s = addressesSummary(addressSample, "ko");
    expect(s).toContain("1");
    expect(s).toContain("서울특별시 중구 세종대로 110");
  });
  it("빈 결과는 결과 없음 요약", () => {
    expect(addressesSummary([], "ko")).toMatch(/없|0/);
  });
});
