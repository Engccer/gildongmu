import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 경유지 포기 문장(N4, 위원장 문안 2026-09-26) 소스 가드 — iOS 모델 계층은 테스트 레인이 없고, 안드로이드 미러는
 * `WalkGuideScenarioTest`가 동작을 잠근다. 웹 `useRouteGuide`의 `viaDropped` 대체 규칙과 같은 계약:
 * 경로 실패(`guide.detailUnavailable`)는 강등 문장을 **대체**하고(붙이지 않는다), 위치 실패는 원인 없는 문장
 * `waypointSkipped`를 덧붙인다(위원장 확정 2026-09-27).
 */
const BEACON = readFileSync("ios/Gildongmu/Directions/BeaconModel.swift", "utf8");

describe("iOS 간략 폴백의 경유지 포기 문장(N4)", () => {
  it("경로 실패는 강등 문장을 대체하고, 위치 실패는 원인 없는 문장을 덧붙인다 — 어느 쪽이든 경유지를 비운다", () => {
    const start = BEACON.indexOf("private func fallbackToBrief(");
    expect(start).toBeGreaterThan(-1);
    const body = BEACON.slice(start, BEACON.indexOf("\n    }\n", start));
    const branch = body.slice(body.indexOf("if let dropped = waypoint {"));
    // 비우기·재시작 인자 동기화·높은 우선순위 표식 — 하나라도 빠지면 화면과 안내가 어긋나거나 통지가 잠식된다.
    for (const line of [
      "waypoint = nil",
      "routeWaypointLabel = nil",
      "syncStartRequestWithSession()",
      "droppedWaypoint = true",
      // 두 인자(경유지·목적지) — ko 문형이 괄호로 이름을 싸서 조사가 고정된다. 인자 순서는 arg-order.json이 잠근다.
      'text = key == "guide.detailUnavailable"',
      '? appLocalized("ios.guide.waypointDropped", dropped.label, destinationLabel)',
      ': text + " " + appLocalized("ios.guide.waypointSkipped", dropped.label)',
    ]) {
      expect(branch, line).toContain(line);
    }
    expect(body).toContain("announce(text, highPriority: droppedWaypoint)");
  });
});
