import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 경유지 포기 문장(N4, 위원장 문안 2026-09-26) 소스 가드 — iOS 모델 계층은 테스트 레인이 없고, 안드로이드 미러는
 * `WalkGuideScenarioTest`가 동작을 잠근다. 웹 `useRouteGuide`의 `viaDropped` 대체 규칙과 같은 계약:
 * 경로 실패(`guide.detailUnavailable`)에서만 경유지를 버리고, 강등 문장을 **대체**한다(붙이지 않는다).
 */
const BEACON = readFileSync("ios/Gildongmu/Directions/BeaconModel.swift", "utf8");

describe("iOS 간략 폴백의 경유지 포기 문장(N4)", () => {
  it("경로 실패에서만 버리고 강등 문장을 대체한다 — 위치 실패에 붙이면 거짓 원인이다", () => {
    const start = BEACON.indexOf("private func fallbackToBrief(");
    expect(start).toBeGreaterThan(-1);
    const body = BEACON.slice(start, BEACON.indexOf("\n    }\n", start));
    expect(body).toContain('if key == "guide.detailUnavailable", let dropped = waypoint {');
    // 두 인자(경유지·목적지) — ko 문형이 괄호로 이름을 싸서 조사가 고정된다. 인자 순서는 arg-order.json이 잠근다.
    expect(body).toContain('text = appLocalized("ios.guide.waypointDropped", dropped.label, destinationLabel)');
    expect(body).not.toMatch(/text \+= .*waypointDropped/);
  });
});
