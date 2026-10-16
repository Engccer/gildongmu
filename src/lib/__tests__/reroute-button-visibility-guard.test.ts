import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * E69 "경로 다시 조회" 버튼 노출 배선의 소스 가드(spec `2026-10-17-reroute-button-visibility-design.md`). iOS 앱 타깃은 테스트 레인이
 * 없어 아래를 되돌려도 다른 테스트가 초록으로 통과한다(웹은 `useRouteGuide.offroute.test.tsx`, 안드로이드는 `WalkGuideScenarioTest`가
 * 동작으로 잠근다).
 * ① 시트 렌더와 착지용 행 존재 사본이 `showsRerouteButton`(= `offRoute` ∧ 래치)을 읽는다 — `offRoute` 단독으로 되돌리면 돌아가는
 *   내내 버튼이 보인다.
 * ② 래치를 세우는 다섯 자리(경로 없음·신선도 미달·실패·예산·정지)와, 회차 시작(확정)에서 내리는 자리.
 * ③ 실패의 래치는 폐기된 조회(토큰이 오른 뒤)에 서지 않는다.
 */
const root = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("iOS", () => {
  const sheet = read("ios/Gildongmu/Directions/BeaconTrackingSheet.swift");
  const model = read("ios/Gildongmu/Directions/BeaconModel.swift");

  it("① 렌더와 행 존재 사본이 같은 노출 조건", () => {
    expect(model).toContain("var showsRerouteButton: Bool { offRoute && rerouteGaveUp }");
    expect(sheet).toContain("if model.showsRerouteButton {");
    expect(sheet).toContain("case .reroute: return tracking && model.showsRerouteButton");
    expect(sheet).not.toMatch(/if model\.offRoute \{/);
  });

  it("② 래치를 세우는 자리와 내리는 자리", () => {
    for (const cause of ["none", "stale", "failed", "budget", "still"]) {
      expect(model, cause).toContain(`raiseRerouteButton(cause: "${cause}"`);
    }
    expect(model).toMatch(
      /offRouteConfirmCoord = lastFixCoord\n\s*\/\/[^\n]*\n\s*rerouteGaveUp = false\n\s*offRouteStillSince = nil/,
    );
    // 정지는 말하지 않고, 운전자 채널은 정지 축도 통지도 없다.
    expect(model).toContain('raiseRerouteButton(cause: "still", speak: false)');
    expect(model).toMatch(/guard offRoute, !driverChannel else \{/);
    expect(model).toMatch(/guard speak, !driverChannel else \{ return \}\s*announce\(appLocalized\("guide\.rerouteAutoGaveUp"\)/);
  });

  it("③ 폐기된 조회의 실패는 래치를 세우지 않는다", () => {
    expect(model).toMatch(
      /guard token == proposalToken, offRoute, isTracking, mode == \.detail else \{ return \}\s*raiseRerouteButton\(cause: "failed"/,
    );
  });
});

describe("안드로이드", () => {
  const sheet = read("android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/ui/GuideSheet.kt");

  it("① 행 존재 정본이 래치를 본다(렌더는 같은 함수를 읽는다)", () => {
    expect(sheet).toContain("SheetRow.reroute -> detail && ui.offRoute && ui.rerouteGaveUp");
    expect(sheet).toContain("if (sheetRowExists(ui, SheetRow.reroute))");
  });
});
