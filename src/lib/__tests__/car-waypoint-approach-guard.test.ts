import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 자동차 경유지 접근 예고(N4 자동차 spec 2026-10-17 §4) 소스 가드 — iOS 모델 계층은 테스트 레인이 없다. 리듀서의 정숙 시간
 * (`waypointApproachQuietS`)은 `lastAnnouncedAt`만 보므로, 리듀서 밖에서 나가는 실행 안내는
 * 자동차 세션에서 그 시각을 적어야 다음 fix의 예고가 갚은 문장을 끊지 않는다 — 받아쓰기 억제 해제 복구와 전경 복귀 갚기
 * 두 자리다. 리듀서 밖 실행 안내를 새로 더하면 이 목록에도 더한다. 도보는 적지 않는다(주기 시각 불변).
 */
const BEACON = readFileSync("ios/Gildongmu/Directions/BeaconModel.swift", "utf8");

describe("iOS 리듀서 밖 실행 안내는 자동차에서 직전 발화 시각이 된다(N4 자동차)", () => {
  const NOTE = "if sessionKind == .car { guideState?.lastAnnouncedAt = uptimeNow }";
  const after = (anchor: string, spoke: string) => {
    const start = BEACON.indexOf(anchor);
    expect(start, anchor).toBeGreaterThan(-1);
    const at = BEACON.indexOf(spoke, start);
    expect(at, spoke).toBeGreaterThan(-1);
    const noted = BEACON.indexOf(NOTE, at);
    // 발화 바로 뒤(사이에 다른 발화 없음)에 적는다.
    expect(noted).toBeGreaterThan(at);
    expect(BEACON.slice(at + spoke.length, noted)).not.toContain("announce(");
  };
  it("받아쓰기 억제 해제 복구", () => {
    after("if !outputSuppressed, let pending = pendingRecovery {", "announce(entered ?? pending, speechClass: .actionable)");
  });
  it("전경 복귀 갚기(owed)", () => {
    after("let owed = (handed.texts", "announce(owed, highPriority: true, speechClass: .actionable)");
  });
  it("오케스트레이터가 리듀서 상태를 고치는 자리는 이 두 곳뿐이다(spec §4)", () => {
    expect(BEACON.match(/\.lastAnnouncedAt = /g)?.length).toBe(2);
  });
});
