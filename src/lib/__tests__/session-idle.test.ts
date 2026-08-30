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
    expect(sessionIdleStep({ secondsSinceUsableFix: -1, secondsSinceProgress: 0 })).toBeNull();
    expect(sessionIdleStep({ secondsSinceUsableFix: NaN, secondsSinceProgress: 0 })).toBeNull();
    expect(sessionIdleStep({ secondsSinceUsableFix: 0, secondsSinceProgress: Infinity })).toBeNull();
  });

  it("국면 무관 안전망은 도착 추정보다 모든 축이 느슨하다(両프로파일 — 경로 중간 정상 이동을 끊지 않는 조건)", () => {
    for (const p of [PRESUMED_ARRIVAL_WALK, PRESUMED_ARRIVAL_CAR]) {
      expect(SESSION_IDLE_NO_FIX_S).toBeGreaterThan(p.noFixSeconds);
      expect(SESSION_IDLE_STATIONARY_S).toBeGreaterThan(p.stationarySeconds);
    }
    expect(SESSION_PROGRESS_EPSILON_M).toBeGreaterThan(PROGRESS_EPSILON_M);
  });

  it("무이동 축이 없으면(null) 두절 축만 산다", () => {
    expect(sessionIdleStep({ secondsSinceUsableFix: 600, secondsSinceProgress: null })).toBe("noFix");
    expect(sessionIdleStep({ secondsSinceUsableFix: NaN, secondsSinceProgress: null })).toBeNull();
  });
});
