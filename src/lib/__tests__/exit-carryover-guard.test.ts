import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 하차 출구 인계(E84, spec 2026-11-14-transit-exit-carryover-design) 소스 가드.
 *
 * 뷰·모델 계층엔 테스트 레인이 없다. 조용히 되돌아가는 자리를 소스에서 잠근다:
 * 출구가 다른 진입점에서 새는 것(잘못 내림 복구·환승 도보·여정), 창이 닫히지 않고 남는 것,
 * 한 번 풀린 세션의 재시작이 창을 다시 여는 것, 하차 준비 줄의 자리·국면·통지.
 * 판정(순수 함수)은 Kit `ExitHoldTests`가 공유 fixture로 잠근다.
 */
const ROOT = join(__dirname, "../../..");
const DIR = join(ROOT, "ios/Gildongmu/Directions");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");
const MODEL = read("BeaconModel.swift");
const COORD = read("GuideSessionCoordinator.swift");
const TAB = read("DirectionsTabView.swift");
const TRANSIT_MODEL = read("TransitGuideModel.swift");
const TRANSIT_SHEET = read("TransitTrackingSheet.swift");
const BEACON_SHEET = read("BeaconTrackingSheet.swift");
const KIT = readFileSync(join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/ExitHold.swift"), "utf8");
const PANEL = readFileSync(join(ROOT, "src/components/TransitGuidePanel.tsx"), "utf8");

function body(src: string, signature: string, end = "\n    }\n"): string {
  const start = src.indexOf(signature);
  expect(start, `${signature} 없음`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf(end, start));
}

/** `StartRequest(` 호출 하나하나의 인자 전문(괄호 짝을 센다). */
function startRequestCalls(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const at = src.indexOf("StartRequest(", i);
    if (at < 0) return out;
    let k = at + "StartRequest(".length;
    for (let depth = 1; depth > 0; k++) {
      if (src[k] === "(") depth++;
      else if (src[k] === ")") depth--;
    }
    out.push(src.slice(at, k));
    i = k;
  }
}

describe("출구 인계의 입구는 하나다", () => {
  it("StartRequest.exitLead는 기본값이 없고, 모든 호출이 명시한다", () => {
    expect(MODEL).toMatch(/let exitLead: ExitLead\?\n {4}\}/);
    const calls = [COORD, TAB, MODEL].flatMap(startRequestCalls);
    expect(calls.length).toBeGreaterThanOrEqual(10);
    for (const call of calls) expect(call, call.slice(0, 80)).toMatch(/exitLead: /);
  });

  it("nil이 아닌 값을 싣는 호출은 acceptWalkHandoff와 재시작 동기화 둘뿐이다", () => {
    const nonNil = [COORD, TAB, MODEL].flatMap(startRequestCalls).filter((c) => !/exitLead: nil\)$/.test(c));
    expect(nonNil).toHaveLength(2);
    expect(body(COORD, "func acceptWalkHandoff()")).toContain("exitLead: exitLead)");
    // 재시작 요청은 **열려 있는 창**의 값만 승계한다 — 창이 풀리면 nil(M4: 재시작이 출구 대기를 다시 열지 않는다).
    expect(body(MODEL, "private func syncStartRequestWithSession()")).toContain("exitLead: exitHold?.lead)");
  });

  it("acceptWalkHandoff는 인계 값에서만, transit.stop() 앞에서 출구를 읽는다", () => {
    const accept = body(COORD, "func acceptWalkHandoff()");
    const read = accept.indexOf("transit.pendingWalkHandoff.flatMap");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(accept.indexOf("transit.stop()"));
    expect(accept).toContain("transitValidExitNo(handoff.exitAlight)");
    // 경로에서 직접 읽으면 잘못 내림 복구의 「걸어가기」가 계획한 역의 출구를 싣는다.
    expect(accept).not.toMatch(/transit\.route|currentLeg|legs\.last/);
  });

  it("인계 값의 출구는 정상 완료(completeOrAdvance)만 세우고 기본값이 없다", () => {
    expect(TRANSIT_MODEL).toMatch(/let exitAlight: String\?\n/);
    expect(TRANSIT_MODEL).not.toMatch(/let exitAlight: String\? = /);
    expect(TRANSIT_MODEL.match(/TransitWalkHandoff\(/g) ?? []).toHaveLength(1);
    expect(TRANSIT_MODEL).toContain("exitAlight: finalLeg?.exitAlight,");
  });
});

describe("출구 대기 창의 수명", () => {
  it("종전 대기 시계를 거는 한 자리가 창을 닫는다 — 목적지 전환·경유지·재획득 전수", () => {
    const watch = body(MODEL, "private func startFixWaitWatch(token: Int) {");
    expect(watch.indexOf("closeExitHold(")).toBeGreaterThan(-1);
    expect(watch.indexOf("closeExitHold(")).toBeLessThan(watch.indexOf("fixWaitTask?.cancel()"));
  });

  it("창을 닫는 자리는 저장된 시작 요청에서도 출구를 내린다", () => {
    const close = body(MODEL, "private func closeExitHold(");
    const cleared = close.indexOf("exitHold = nil");
    expect(cleared).toBeGreaterThan(-1);
    expect(close.indexOf("syncStartRequestWithSession()")).toBeGreaterThan(cleared);
    // 창 상태를 직접 지우는 자리는 닫는 함수와 세션 종료(stop) 둘뿐이다.
    expect(MODEL.match(/\bexitHold = nil\b/g) ?? []).toHaveLength(2);
  });

  it("창이 열리면 종전 15초 시계를 걸지 않는다(창은 fix 증거와 사용자 선언이 닫는다)", () => {
    expect(MODEL).toMatch(
      /if kind == \.walk, let exitLead \{[^}]*openExitHold\(exitLead\)\s*\} else \{\s*startFixWaitWatch\(token: routeFetchToken\)/,
    );
    const open = body(MODEL, "private func openExitHold(");
    expect(open).not.toMatch(/Task \{|Task\.sleep/);
    // 창 안 판정은 Kit 순수 함수 하나만 지난다.
    expect(body(MODEL, "private func handleExitHoldFix(", "\n    }\n\n")).toContain("switch exitHoldStep(");
    expect(KIT).not.toMatch(/import (UIKit|SwiftUI|CoreLocation)/);
  });

  it("창 동안 안전망 임계는 GuideTuning 데이터로 갈린다(sessionKind 분기 없음)", () => {
    const idle = body(MODEL, "private func maybeEndIdleSession(now: Double) -> Bool {");
    expect(KIT).toContain(
      "noFixSeconds: holdActive ? tuning.sessionIdleNoFixExitHoldSeconds : tuning.sessionIdleNoFixSeconds)",
    );
    // 창이 세운 하한 뒤로 잰다(관측 공백 뒤 첫 fix, 창이 닫힌 시각). 하한이 없으면 종전 식이다.
    expect(idle).toContain("exitHoldAwareSessionIdleStep(");
    // 창 안 fix의 하한 갱신은 직전 fix 시각을 읽으므로 `lastFixAt = now`보다 앞이어야 한다(뒤면 간격이 늘 0이라 영영 안 선다).
    const waiting = MODEL.slice(MODEL.indexOf("        if awaitingRoute {\n            // 출구 대기(E84)"));
    const floorsCall = waiting.indexOf("exitHoldIdleFloorsAfterFix(");
    expect(floorsCall).toBeGreaterThan(0);
    expect(waiting.slice(floorsCall, floorsCall + 200)).toContain("previousFixAt: lastFixAt, startedAt: startedAt,");
    expect(floorsCall).toBeLessThan(waiting.indexOf("lastFixAt = now"));
    expect(waiting.slice(0, waiting.indexOf("lastFixAt = now"))).toContain(
      "if step.resumed { sessionProgressAnchor = RoutePoint(lat: fix.lat, lng: fix.lng) }",
    );
    expect(waiting.slice(0, waiting.indexOf("lastFixAt = now"))).toContain("distanceFromAnchor: sessionProgressAnchor.map {");
    expect(idle).toContain("floors: exitHoldIdleFloors, holdActive: exitHold != nil, tuning: tuning,");
    expect(idle).not.toMatch(/sessionIdleStep\(|max\(startedAt/);
    expect(body(MODEL, "private func closeExitHold(")).toContain(
      "exitHoldIdleFloors = exitHoldIdleFloorsAfterClose(now: uptimeNow)",
    );
    // 하한을 세우는 자리는 창 안 fix와 창 닫힘 둘, 지우는 자리는 시작·창 열기·종료 셋이다.
    expect(MODEL.match(/exitHoldIdleFloors = ExitHoldIdleFloors\(\)/g) ?? []).toHaveLength(4);
    expect(MODEL.match(/exitHoldIdleFloors = (?!ExitHoldIdleFloors\(\))/g) ?? []).toHaveLength(2);
    expect(idle).not.toMatch(/switch sessionKind|sessionKind == /);
  });

  it("접두 판정은 Kit 술어를 지나고 발화 끝 신호(announcementsSettled)에 걸지 않는다", () => {
    const lead = body(MODEL, "private func withExitLead(");
    expect(lead).toContain("exitLeadPrefixNeeded(");
    expect(lead).not.toContain("announcementsSettled");
    expect(MODEL.match(/withExitLead\(text\)/g) ?? []).toHaveLength(2);
  });

  it("계측 줄에 좌표가 없다", () => {
    for (const line of MODEL.split("\n").filter((l) => /exitHold|routeOriginWait acc=/.test(l) && l.includes("guideDiagLog")))
      expect(line).not.toMatch(/\.lat\b|\.lng\b/);
    const fix = body(MODEL, "private func handleExitHoldFix(", "\n    }\n\n");
    const log = fix.slice(fix.indexOf("guideDiagLog("), fix.indexOf("switch exitHoldStep("));
    expect(log).toMatch(/speed=.*speedAcc=/s);
    expect(log).not.toMatch(/candidate\.lat|candidate\.lng|raw\.lat|raw\.lng/);
  });
});

describe("시트", () => {
  it("도보 시트: 출구 줄은 상태 행 자리를 유도 값으로 쓰고, 해제 버튼은 그 바로 다음이며 disabled가 아니다", () => {
    const row = BEACON_SHEET.indexOf("if let text = statusRowText {");
    const button = BEACON_SHEET.indexOf('focusTarget(Button(appLocalized("ios.guide.exitHoldRelease"))');
    expect(row).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(row);
    const between = BEACON_SHEET.slice(row, button);
    expect(between).not.toMatch(/Button\(|Text\(appLocalized/);
    const action = BEACON_SHEET.slice(button, BEACON_SHEET.indexOf("\n                    }\n", button));
    expect(action).toContain("model.declareExitedStation()");
    expect(action).toContain('requestInfoLanding(note: "exitDeclared")');
    expect(action).not.toContain(".disabled(");
    // 창이 위치 증거로 저절로 닫히면 버튼이 사라진다: 커서가 그 위였으면 소실 복구가 돌도록 착지 바인딩에 건다.
    expect(action).toContain("}, .exitRelease)");
    expect(body(BEACON_SHEET, "private var statusRowText: String? {")).toContain("model.exitHoldLine");
    // 출구 줄은 모델의 statusText에 쓰지 않는다(창이 풀리면 줄도 사라진다).
    expect(MODEL).not.toMatch(/statusText = .*exitHold/);
    // 창 동안은 조회를 기다리지 않고 착지한다.
    expect(BEACON_SHEET).toContain("guard model.awaitingRoute, !model.exitHoldActive else {");
  });

  it("선언 버튼은 재진입을 모델 가드로 막는다", () => {
    const declare = body(MODEL, "func declareExitedStation() {");
    expect(declare).toContain("guard isTracking, awaitingRoute, exitHold != nil, routeFetchTask == nil else { return }");
    expect(declare).toContain("startFixWaitWatch(token: routeFetchToken)");
  });

  it("대중교통 시트: 하차 준비 줄은 국면 버튼 다음·주변 섹션 앞이고 boarding·riding에만 서며 통지·착지가 없다", () => {
    expect(TRANSIT_SHEET).toMatch(
      /phaseControls\(proxy: proxy\)\s*alightPrepRow\s*\}\s*surroundingsSection\(proxy: proxy\)/,
    );
    const row = body(TRANSIT_SHEET, "@ViewBuilder private var alightPrepRow: some View {");
    expect(row).toContain("state.phase == .boarding || state.phase == .riding");
    expect(row).toContain("alightLineText(");
    expect(row).not.toMatch(/announce|landingTarget|accessibilityFocused|\.arrived|\.waiting/);
  });

  it("웹: 하차 준비 줄은 boarding·riding에만, 말미 도보 인계가 출구를 넘긴다", () => {
    expect(PANEL).toContain('{(state.phase === "boarding" || state.phase === "riding") && alightPrep && (');
    expect(PANEL).toContain("exitLead={guide.doneHandoff.exitAlight}");
    expect(PANEL.match(/exitLead=/g) ?? []).toHaveLength(1);
  });
});
