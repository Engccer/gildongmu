import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 자동차 경유지 접근 예고(N4 자동차 spec 2026-10-17 §4) 소스 가드 — iOS 모델 계층은 테스트 레인이 없다. 리듀서의 정숙 시간
 * (`waypointApproachQuietS`)은 `lastAnnouncedAt`만 보므로, 리듀서 밖에서 나가는 실행 안내(받아쓰기 억제 해제 복구)는
 * 자동차 세션에서 그 시각을 적어야 다음 fix의 예고가 갚은 문장을 끊지 않는다. 도보는 적지 않는다(주기 시각 불변).
 */
const BEACON = readFileSync("ios/Gildongmu/Directions/BeaconModel.swift", "utf8");

describe("iOS 억제 해제 복구 발화는 자동차에서 직전 발화 시각이 된다(N4 자동차)", () => {
  it("복구 announce 바로 뒤, 자동차 세션에서만 guideState.lastAnnouncedAt을 적는다", () => {
    const start = BEACON.indexOf("if !outputSuppressed, let pending = pendingRecovery {");
    expect(start).toBeGreaterThan(-1);
    const block = BEACON.slice(start, BEACON.indexOf("\n            }\n", start));
    const spoke = block.indexOf("announce(entered ?? pending, speechClass: .actionable)");
    const noted = block.indexOf("if sessionKind == .car { guideState?.lastAnnouncedAt = uptimeNow }");
    expect(spoke).toBeGreaterThan(-1);
    expect(noted).toBeGreaterThan(spoke);
    // 오케스트레이터가 리듀서 상태를 고치는 자리는 이 하나뿐이다(spec §4).
    expect(BEACON.match(/\.lastAnnouncedAt = /g)?.length).toBe(1);
  });
});
