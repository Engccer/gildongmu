import { describe, expect, it } from "vitest";
import { transitBoardLegNames, transitLegUsesEnglish } from "../transit-leg-english";
import type { TransitLeg } from "../types";

// Kit `TransitExitLinesTests`의 `transitLegUsesEnglish` 판정과 같은 표(웹 미러).
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

describe("transitLegUsesEnglish", () => {
  it("ko 세션은 영문이 다 있어도 한국어", () => {
    expect(transitLegUsesEnglish(subway(), false)).toBe(false);
  });
  it("en 세션은 노선·승차·하차 영문이 다 있을 때만 영어", () => {
    expect(transitLegUsesEnglish(subway(), true)).toBe(true);
    for (const over of [{ lineNameEn: undefined }, { fromNameEn: undefined }, { toNameEn: undefined }]) {
      expect(transitLegUsesEnglish(subway(over), true)).toBe(false);
    }
  });
  it("빈 영문은 결측이다(공백·탭·개행)", () => {
    for (const blank of ["", " ", "\t\n"]) {
      for (const over of [{ lineNameEn: blank }, { fromNameEn: blank }, { toNameEn: blank }]) {
        expect(transitLegUsesEnglish(subway(over), true)).toBe(false);
      }
    }
  });
  it("한국어 쪽에 없는 조각은 영문을 요구하지 않는다", () => {
    expect(transitLegUsesEnglish(subway({ toName: undefined, toNameEn: undefined }), true)).toBe(true);
    expect(transitLegUsesEnglish(subway({ fromName: " ", fromNameEn: undefined }), true)).toBe(true);
  });
  it("도보: 행선지가 없으면(마지막 도보) 영어, 있으면 영문 행선지가 있어야 영어", () => {
    expect(transitLegUsesEnglish({ mode: "walk", minutes: 2 }, true)).toBe(true);
    expect(transitLegUsesEnglish({ mode: "walk", minutes: 2, toName: " " }, true)).toBe(true);
    expect(transitLegUsesEnglish({ mode: "walk", minutes: 2, toName: "개화" }, true)).toBe(false);
    expect(transitLegUsesEnglish({ mode: "walk", minutes: 2, toName: "개화", toNameEn: " " }, true)).toBe(false);
    expect(transitLegUsesEnglish({ mode: "walk", minutes: 2, toName: "개화", toNameEn: "Gaehwa" }, true)).toBe(true);
    expect(transitLegUsesEnglish({ mode: "walk", minutes: 2 }, false)).toBe(false);
  });
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
