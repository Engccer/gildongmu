import { describe, expect, it } from "vitest";
import cases from "./fixtures/car-arrival-cases.json";
import { carArrivalStep } from "../car-arrival";
import type { MotionState } from "../guide-motion";

describe("carArrivalStep 공유 경계표(Kit CarArrivalTests 동형)", () => {
  for (const c of cases.cases) {
    it(`${c.note}: ${c.distance}m acc ${c.accuracy} ${c.motion} → ${c.expect}`, () => {
      expect(carArrivalStep(c.distance, c.accuracy, c.motion as MotionState)).toBe(c.expect);
    });
  }
});
