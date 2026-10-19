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
      /offRouteConfirmCoord = lastFixCoord\n\s*\/\/[^\n]*\n\s*rerouteGaveUp = false\n\s*rerouteGaveUpSpoken = false\n\s*offRouteStillSince = nil/,
    );
    // 정지는 말하지 않고, 운전자 채널은 정지 축도 통지도 없다.
    expect(model).toContain('raiseRerouteButton(cause: "still", speak: false)');
    expect(model).toMatch(/guard offRoute, phase == \.offRoute, !driverChannel else \{/);
    expect(model).toContain("guard speak, !driverChannel, !rerouteGaveUpSpoken else { return }");
  });

  it("② 예산 래치는 자동 재조회 요청(rerouteNeeded) 무시 자리에 있다 — 운전자 확정 자리만 남기면 도보에서 서지 않는다", () => {
    const start = model.indexOf("case let .rerouteNeeded(reason):");
    const block = model.slice(start, model.indexOf("case .uncertainEnter:", start));
    expect(block).toContain('if ignored == "budget" { raiseRerouteButton(cause: "budget", speak: true) }');
  });

  it("② 실패 문장의 '말했음' 표식은 버려지면 되돌린다(1회성 통지는 전달된 시점에 래치)", () => {
    expect(model).toMatch(/rerouteGaveUpSpoken = true\s*announce\(appLocalized\("guide\.rerouteAutoGaveUp"\), speechClass: \.actionable\) \{ \[weak self\] in\s*self\?\.rerouteGaveUpSpoken = false/);
  });

  it("③ 폐기된 조회의 실패는 래치를 세우지 않는다", () => {
    expect(model).toMatch(
      /guard token == proposalToken, declared \|\| offRoute, isTracking, mode == \.detail else \{ return \}\s*if declared \{ differentRouteFailed\(cause: "failed"\) \} else \{ raiseRerouteButton\(cause: "failed"/,
    );
  });

  it("E74 직접 누른 「다른 길로 가기」의 실패는 「자동으로」가 없는 문장이다(위원장 판정 2026-10-19) — 자동 갈래는 그대로", () => {
    const start = model.indexOf("private func differentRouteFailed(");
    const body = model.slice(start, model.indexOf("\n    }\n", start));
    expect(body).toMatch(/statusText = appLocalized\("ios\.guide\.differentRouteFailed"\)[^]*announce\(statusText, highPriority: true/);
    expect(body).not.toContain('appLocalized("guide.rerouteAutoGaveUp")');
    const frames = (locale: string) =>
      JSON.parse(read(`ios/i18n/ios-extra/${locale}.json`)).ios.guide as Record<string, string>;
    const auto = (locale: string) => JSON.parse(read(`messages/${locale}.json`)).guide.rerouteAutoGaveUp as string;
    for (const locale of ["ko", "en", "es", "fr", "it", "ja"]) {
      expect(frames(locale).differentRouteFailed, locale).toBeTruthy();
      expect(frames(locale).differentRouteFailed, locale).not.toBe(auto(locale));
    }
    expect(frames("ko").differentRouteFailed).toBe("새 경로를 찾지 못했습니다.");
    expect(frames("en").differentRouteFailed).toBe("Couldn't find a new route.");
  });
});

describe("안드로이드", () => {
  const sheet = read("android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/ui/GuideSheet.kt");
  const model = read("android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/WalkGuideModel.kt");

  it("② 래치를 세우는 자리(출발점 없음·실패·경로 없음·신선도 미달·예산·정지)", () => {
    expect(model).toContain('if (token == proposalToken && offRoute && isTracking && mode == GuideMode.detail) raiseRerouteButton("failed", speak = true)');
    expect(model).toContain("raiseRerouteButton(cause, speak = true)");
    expect(model).toContain('raiseRerouteButton("stale", speak = true)');
    expect(model).toContain('if (ignored == "budget") raiseRerouteButton("budget", speak = true)');
    expect(model).toContain('raiseRerouteButton("still", speak = false)');
    // 새 회차는 버튼 없이 시작한다.
    expect(model).toMatch(/offRouteConfirmCoord = lastFixCoord\n\s*\/\/[^\n]*\n\s*rerouteGaveUp = false\n\s*rerouteGaveUpSpoken = false\n\s*offRouteStillSince = null/);
    expect(model).toMatch(/rerouteGaveUpSpoken = true\s*announce\(strings\.get\("guide\.rerouteAutoGaveUp"\), speechClass = GuideSpeechClass\.actionable\) \{ rerouteGaveUpSpoken = false \}/);
  });

  it("① 행 존재 정본이 래치를 본다(렌더는 같은 함수를 읽는다)", () => {
    expect(sheet).toContain("SheetRow.reroute -> detail && ui.offRoute && ui.rerouteGaveUp");
    expect(sheet).toContain("if (sheetRowExists(ui, SheetRow.reroute))");
  });
});

describe("웹", () => {
  const hook = read("src/hooks/useRouteGuide.ts");
  const block = hook.slice(hook.indexOf("const autoReroute = useCallback("), hook.indexOf("// 전경 전용(스펙 §9)"));

  it("② 래치를 세우는 자리(예산·실패/경로 없음·신선도 미달) — 동작 테스트는 실패와 정지만 밟는다", () => {
    expect(block).toMatch(/if \(!mayFetchReroute\(autoRerouteCountRef\.current\)\) \{\s*raiseRerouteButton\(true\);/);
    expect(block).toMatch(/sameVia\(fetched\.via, excludedViaRef\.current\)\) \{\s*raiseRerouteButton\(true\);/);
    expect(block).toMatch(/isRerouteProposalFresh\(proposal, now, cur, tuning\.rerouteMaxDriftM\)\s*\) \{\s*raiseRerouteButton\(true\);/);
    expect(hook).toMatch(/if \(!speak \|\| rerouteGaveUpSpokenRef\.current\) return;/);
  });
});
