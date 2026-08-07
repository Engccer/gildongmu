import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as web from "../guide-motion";

/**
 * 정지 판정 상수의 웹↔Kit 드리프트 가드(`format-drift.test.ts` 선례).
 *
 * 두 스위트는 각자 같은 케이스를 손으로 두 번 적어 둔 것이라, **한쪽 상수만 바꾸면
 * 그 스위트도 함께 바뀌어 조용히 통과한다**. 특히 `stopEnterMps` 0.4는 위원장 판정
 * 확정값이고 1급 사용자 집단의 보행 속도에 걸린 수치다 — 한쪽만 흔들리면 플랫폼마다
 * `tick`(정지)의 뜻이 달라지고, 그것이 이 마일스톤이 없애려던 부채 그 자체다.
 */
const KIT = path.resolve(
  __dirname,
  "../../../ios/GildongmuKit/Sources/GildongmuKit/GuideMotion.swift",
);

/** 웹 상수 이름 → Swift `MotionConstants` 프로퍼티 이름. */
const PAIRS: [number, string][] = [
  [web.STOP_ENTER_MPS, "stopEnterMps"],
  [web.STOP_EXIT_MPS, "stopExitMps"],
  [web.STOP_ENTER_HOLD_S, "stopEnterHoldSeconds"],
  [web.SPEED_ACCURACY_CEILING_MPS, "speedAccuracyCeiling"],
  [web.FALLBACK_MIN_INTERVAL_S, "fallbackMinIntervalSeconds"],
  [web.FALLBACK_MAX_INTERVAL_S, "fallbackMaxIntervalSeconds"],
  [web.FALLBACK_MAX_ACCURACY_M, "fallbackMaxAccuracyMeters"],
  [web.MAX_WALK_SPEED_MPS, "maxWalkSpeedMps"],
  [web.MAX_CAR_SPEED_MPS, "maxCarSpeedMps"],
];

describe("정지 판정 상수 웹↔Kit 동조", () => {
  const swift = readFileSync(KIT, "utf8");

  for (const [webValue, swiftName] of PAIRS) {
    it(`${swiftName} = ${webValue}`, () => {
      const m = swift.match(
        new RegExp(`static let ${swiftName}\\s*=\\s*(-?[0-9.]+)`),
      );
      expect(m, `Swift에 ${swiftName} 선언이 없다`).not.toBeNull();
      expect(Number(m![1])).toBe(webValue);
    });
  }

  it("Swift 상수 표에 웹이 모르는 항목이 없다(한쪽만 추가되는 드리프트 차단)", () => {
    const declared = [...swift.matchAll(/static let (\w+)\s*=\s*-?[0-9.]+/g)].map(
      (m) => m[1],
    );
    expect(new Set(declared)).toEqual(new Set(PAIRS.map(([, name]) => name)));
  });
});
