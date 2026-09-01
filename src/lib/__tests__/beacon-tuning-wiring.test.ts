import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `BeaconModel`(앱 타깃, 테스트 레인 없음)이 세션 종료 갈림 셋을 **튜닝 데이터로 읽는지**를 소스로
 * 잠근다(spec 2026-08-31 §7 — Kit·웹 테스트는 튜닝 값만 잠그고, 배선이 상수를 직접 박거나
 * `sessionKind` switch로 되돌아가면 전부 통과한 채 실차에서만 드러난다). `guidance-gate-drift` 관례.
 */
const src = readFileSync(new URL("../../../ios/Gildongmu/Directions/BeaconModel.swift", import.meta.url), "utf8");

describe("BeaconModel 세션 종료 갈림은 GuideTuning 데이터를 읽는다", () => {
  it.each([
    "tuning.presumedArrival",
    "tuning.entersFinalApproachWithoutGeometry",
    "tuning.sessionIdleStationaryAxis",
  ])("%s 참조", (needle) => {
    expect(src.includes(needle)).toBe(true);
  });

  it("프로파일 리터럴(.walk/.car)을 판정 함수에 직접 넘기지 않는다", () => {
    expect(src).not.toMatch(/thresholds:\s*\.(walk|car)\b/);
    expect(src).not.toMatch(/PresumedArrivalThresholds\.(walk|car)/);
  });

  it("국면 무관 안전망을 sessionKind로 가르지 않는다(walk 전용 가드 재도입 금지)", () => {
    const idle = src.slice(src.indexOf("func maybeEndIdleSession"), src.indexOf("func maybePresumeArrival"));
    expect(idle).not.toMatch(/sessionKind\s*==\s*\.walk/);
  });
});

describe("도착 창(A31 §2, spec 2026-09-02): 간략 근처 창 배선", () => {
  const presume = src.slice(src.indexOf("func maybePresumeArrival"), src.indexOf("func loadArrivalHealth"));

  it("추정 도착 가드는 inArrivalWindow를 읽고 inFinalApproach 단독 가드로 되돌아가지 않는다", () => {
    expect(presume).toMatch(/guard isTracking, inArrivalWindow/);
    expect(presume).not.toMatch(/guard isTracking, inFinalApproach/);
  });

  it("maybePresumeArrival 호출은 세 자리(최종 접근·간략 fix·워치독)", () => {
    expect(src.match(/maybePresumeArrival\(now: now\)/g)?.length).toBe(3);
  });

  it("간략 fix 처리는 창 자격을 Kit 리듀서로 정한다(nearby를 직접 창 진입 근거로 읽지 않는다)", () => {
    expect(src.includes("briefArrivalWindowStep(")).toBe(true);
  });

  it("resetFinalApproach가 간략 창 플래그까지 지운다(경로 커밋·재획득·stop에서 옛 창이 살아남지 않게)", () => {
    const reset = src.slice(src.indexOf("func resetFinalApproach"), src.indexOf("func beginFinalApproach"));
    expect(reset).toMatch(/resetArrivalWindow\(\)/);
    const window = src.slice(src.indexOf("func resetArrivalWindow"), src.indexOf("func resetFinalApproach"));
    expect(window).toMatch(/briefWindowActive = false/);
  });
});
