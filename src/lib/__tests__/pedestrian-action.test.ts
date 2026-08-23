import { describe, expect, it } from "vitest";
import { pedestrianStepFor, PEDESTRIAN_TURN_TYPES } from "../pedestrian-action";

describe("pedestrianStepFor", () => {
  it("관측 코드의 행동과 문구를 함께 낸다", () => {
    expect(pedestrianStepFor(12)).toEqual({ action: "left", phrase: "Turn left" });
    expect(pedestrianStepFor(13)).toEqual({ action: "right", phrase: "Turn right" });
    expect(pedestrianStepFor(211)).toEqual({ action: "crosswalk", phrase: "Cross the crosswalk" });
    expect(pedestrianStepFor(212)).toEqual({
      action: "crosswalk",
      phrase: "Cross the crosswalk on your left",
    });
    expect(pedestrianStepFor(126)).toEqual({ action: "underpass", phrase: "Take the underpass" });
    expect(pedestrianStepFor(201)).toEqual({ action: null, phrase: "Arrive at your destination" });
  });

  it("시계 방위를 좌우로 접지 않는다(갈림길 가지 지목 정보)", () => {
    expect(pedestrianStepFor(17)).toEqual({ action: "left", phrase: "Turn to your 10 o'clock" });
    expect(pedestrianStepFor(18)).toEqual({ action: "right", phrase: "Turn to your 2 o'clock" });
    expect(pedestrianStepFor(216)).toEqual({
      action: "crosswalk",
      phrase: "Cross the crosswalk at 2 o'clock",
    });
  });

  it("행동절 없는 코드는 phrase가 null이고 행동도 없다", () => {
    for (const tt of [0, 1, 7, 11, 184, 189, 200, 233]) {
      expect(pedestrianStepFor(tt)).toEqual({ action: null, phrase: null });
    }
  });

  it("육교·계단·경사로·엘리베이터는 문구만 있고 행동은 null이다", () => {
    for (const tt of [125, 127, 128, 129, 218]) {
      const s = pedestrianStepFor(tt);
      expect(s?.action).toBeNull();
      expect(s?.phrase).toBeTruthy();
    }
  });

  it("미지 코드는 null(호출부가 throw)", () => {
    expect(pedestrianStepFor(9999)).toBeNull();
    expect(pedestrianStepFor(-1)).toBeNull();
  });

  it("좌우 문구와 행동이 어긋나지 않는다(표 오타 가드)", () => {
    for (const tt of PEDESTRIAN_TURN_TYPES) {
      const s = pedestrianStepFor(tt);
      if (!s?.phrase) continue;
      const p = s.phrase.toLowerCase();
      if (s.action === "left") expect(p).toMatch(/left|8 o'clock|10 o'clock/);
      if (s.action === "right") expect(p).toMatch(/right|2 o'clock|4 o'clock/);
    }
  });
});
