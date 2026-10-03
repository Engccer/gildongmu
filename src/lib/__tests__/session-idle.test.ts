import { describe, expect, it } from "vitest";
import fixture from "./fixtures/session-idle-scenarios.json";
import {
  SESSION_IDLE_ARRIVAL_GRACE_S,
  sessionIdleStationaryElapsed,
  SESSION_IDLE_NO_FIX_CAR_S,
  SESSION_IDLE_NO_FIX_WALK_S,
  SESSION_IDLE_STATIONARY_S,
  SESSION_PROGRESS_EPSILON_M,
  sessionIdleStep,
  type SessionIdleInput,
} from "../session-idle";
import {
  PRESUMED_ARRIVAL_CAR,
  PRESUMED_ARRIVAL_WALK,
  PROGRESS_EPSILON_M,
} from "../final-approach";

describe("sessionIdleStep (공유 fixture)", () => {
  for (const s of fixture.scenarios) {
    it(s.name, () => {
      expect(sessionIdleStep(s.input as SessionIdleInput)).toBe(s.expect);
    });
  }

  it("무효 입력(음수·NaN·무한)은 null", () => {
    expect(sessionIdleStep({ secondsSinceUsableFix: -1, secondsSinceProgress: 0, noFixSeconds: 300 })).toBeNull();
    expect(sessionIdleStep({ secondsSinceUsableFix: NaN, secondsSinceProgress: 0, noFixSeconds: 300 })).toBeNull();
    expect(sessionIdleStep({ secondsSinceUsableFix: 0, secondsSinceProgress: Infinity, noFixSeconds: 300 })).toBeNull();
  });

  it("국면 무관 안전망은 도착 추정보다 조이지 않는다(両프로파일 — 두절은 더 길고 무이동은 같거나 길다)", () => {
    for (const [noFix, p] of [
      [SESSION_IDLE_NO_FIX_WALK_S, PRESUMED_ARRIVAL_WALK],
      [SESSION_IDLE_NO_FIX_CAR_S, PRESUMED_ARRIVAL_CAR],
    ] as const) {
      expect(noFix).toBeGreaterThan(p.noFixSeconds);
      expect(SESSION_IDLE_STATIONARY_S).toBeGreaterThanOrEqual(p.stationarySeconds);
    }
    expect(SESSION_PROGRESS_EPSILON_M).toBeGreaterThan(PROGRESS_EPSILON_M);
  });

  it("무이동 축이 없으면(null) 두절 축만 산다", () => {
    const noFixSeconds = SESSION_IDLE_NO_FIX_CAR_S;
    expect(sessionIdleStep({ secondsSinceUsableFix: noFixSeconds, secondsSinceProgress: null, noFixSeconds })).toBe("noFix");
    expect(sessionIdleStep({ secondsSinceUsableFix: 1, secondsSinceProgress: null, noFixSeconds })).toBeNull();
    expect(sessionIdleStep({ secondsSinceUsableFix: NaN, secondsSinceProgress: null, noFixSeconds })).toBeNull();
  });
});

describe("sessionIdleStationaryElapsed (공유 fixture graceScenarios)", () => {
  for (const s of fixture.graceScenarios) {
    it(s.name, () => {
      expect(sessionIdleStationaryElapsed(s.input.secondsSinceProgress, s.input.presumedArrivalCanFire)).toBe(s.expect);
    });
  }

  it("유예는 도착 추정 제자리 축(300초)이 먼저 판정할 기회를 준다", () => {
    expect(SESSION_IDLE_STATIONARY_S + SESSION_IDLE_ARRIVAL_GRACE_S).toBeGreaterThan(PRESUMED_ARRIVAL_WALK.stationarySeconds);
  });
});
