import { describe, expect, it } from "vitest";
import { transitBoardLegNames, transitLegUsesEnglish } from "../transit-leg-english";
import type { TransitLeg } from "../types";
import fixture from "./fixtures/transit-leg-english-cases.json";

// 판정표는 공유 fixture(Kit `transitLegUsesEnglish`·안드로이드 :kit과 같은 표).
describe("transitLegUsesEnglish — 공유 fixture", () => {
  it("fixture가 비지 않았다", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(15);
  });
  it.each(fixture.cases)("$id", (c) => {
    expect(transitLegUsesEnglish({ minutes: 1, ...c.leg } as TransitLeg, c.english)).toBe(c.expected);
  });
});

const subway = (over: Partial<TransitLeg> = {}): TransitLeg => ({
  mode: "subway",
  lineName: "수도권 9호선",
  lineNameEn: "Line 9",
  fromName: "개화",
  fromNameEn: "Gaehwa",
  toName: "중앙보훈병원",
  toNameEn: "VHS Medical Center",
  stationCount: 15,
  minutes: 30,
  ...over,
});

describe("transitBoardLegNames — 탑승 줄 이름(화면·WebMCP 공용)", () => {
  it("영어 줄이면 노선·승차·하차 모두 영문", () => {
    expect(transitBoardLegNames(subway(), true)).toEqual({
      english: true,
      line: "Line 9",
      from: "Gaehwa",
      to: "VHS Medical Center",
    });
  });
  it("영문 조각 하나가 없으면 셋 다 한국어(한 줄 안에서 언어를 섞지 않는다)", () => {
    expect(transitBoardLegNames(subway({ toNameEn: undefined }), true)).toEqual({
      english: false,
      line: "수도권 9호선",
      from: "개화",
      to: "중앙보훈병원",
    });
  });
  it("ko 세션은 원문 그대로", () => {
    expect(transitBoardLegNames(subway(), false).line).toBe("수도권 9호선");
  });
});
