import { describe, expect, it } from "vitest";
import fixture from "./fixtures/session-idle-scenarios.json";
import {
  SESSION_IDLE_NO_FIX_S,
  SESSION_IDLE_STATIONARY_S,
  SESSION_PROGRESS_EPSILON_M,
  sessionIdleStep,
  type SessionIdleInput,
} from "../session-idle";
import {
  PRESUMED_ARRIVAL_NO_FIX_S,
  PRESUMED_ARRIVAL_STATIONARY_S,
  PROGRESS_EPSILON_M,
} from "../final-approach";

describe("sessionIdleStep (공유 fixture)", () => {
  for (const s of fixture.scenarios) {
    it(s.name, () => {
      expect(sessionIdleStep(s.input as SessionIdleInput)).toBe(s.expect);
    });
  }

  it("무효 입력(음수·NaN·무한)은 null", () => {
    expect(sessionIdleStep({ secondsSinceUsableFix: -1, secondsSinceProgress: 0 })).toBeNull();
    expect(sessionIdleStep({ secondsSinceUsableFix: NaN, secondsSinceProgress: 0 })).toBeNull();
    expect(sessionIdleStep({ secondsSinceUsableFix: 0, secondsSinceProgress: Infinity })).toBeNull();
  });

  it("국면 무관 안전망은 도착 추정보다 모든 축이 느슨하다(경로 중간 정상 보행을 끊지 않는 조건)", () => {
    expect(SESSION_IDLE_NO_FIX_S).toBeGreaterThan(PRESUMED_ARRIVAL_NO_FIX_S);
    expect(SESSION_IDLE_STATIONARY_S).toBeGreaterThan(PRESUMED_ARRIVAL_STATIONARY_S);
    expect(SESSION_PROGRESS_EPSILON_M).toBeGreaterThan(PROGRESS_EPSILON_M);
  });
});
