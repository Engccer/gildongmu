import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 도보·자동차·나들이 안내 시트의 착지 계약 소스 가드(E57, spec 2026-09-30-guide-sheet-info-row-landing).
 *
 * 뷰 계층엔 테스트 레인이 없고 착지는 시뮬레이터로 검출되지 않는다(실기기 로그 `sheetFocus … landed=`만이 판정).
 * 위원장 요청("최상단 헤딩이 아닌 남은 거리 행")이 되돌아가는 자리 — 열림 착지가 제목으로, 첫 정보 행의 순서가
 * 뒤바뀌는 것, 경로·요약 대기와 소실 복구·자식 시트 닫힌 뒤 착지가 빠지는 것 — 를 소스에서 잠근다.
 * 선례: `transit-landing-guard.test.ts`.
 */
const ROOT = join(__dirname, "../../..");
const DIR = join(ROOT, "ios/Gildongmu/Directions");
const BEACON = readFileSync(join(DIR, "BeaconTrackingSheet.swift"), "utf8");
const OUTING = readFileSync(join(DIR, "OutingSheet.swift"), "utf8");
const MODEL = readFileSync(join(DIR, "BeaconModel.swift"), "utf8");
const TRANSIT = readFileSync(join(DIR, "TransitTrackingSheet.swift"), "utf8");

function body(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `${signature} 없음`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n    }\n", start));
}

describe("BeaconTrackingSheet 착지 (E57)", () => {
  it("착지 바인딩은 옵셔널 하나이고 focusTarget 헬퍼 한 자리에만 붙는다", () => {
    expect(BEACON).toContain("@AccessibilityFocusState private var focusedRow: SheetFocus?");
    expect(BEACON).not.toMatch(/@AccessibilityFocusState private var \w+: Bool/);
    expect(BEACON.match(/\.accessibilityFocused\(/g) ?? []).toHaveLength(1);
    expect(body(BEACON, "private func focusTarget<")).toContain(
      "view.accessibilityFocused($focusedRow, equals: target)",
    );
  });

  it("시트 열림·띠바 복귀는 첫 정보 행을 요청한다 — 제목·접기 버튼 착지가 되살아나지 않는다(종료 화면은 도착 문장)", () => {
    const start = BEACON.indexOf(".task {");
    const task = BEACON.slice(start, BEACON.indexOf("\n        }\n", start));
    expect(task).toContain("landFocus(.arrived)");
    expect(task).toContain('requestInfoLanding(note: "open", afterSummary: false)');
    expect(task).not.toMatch(/\.title\b|\.minimize\b|returnedFromBand/);
    expect(BEACON).not.toMatch(/landTitleFocus|titleFocused|case minimize/);
    // 띠바 복귀 분기 표지는 세 시트 어디에도 없다(E57 위원장 판정 Q1).
    for (const src of [BEACON, OUTING, TRANSIT]) expect(src).not.toContain("returnedFromBand");
    // 같은 콘텐츠 뷰 안에서 새 세션이 서는 경로(spec §3.5).
    expect(BEACON).toMatch(
      /\.onChange\(of: model\.isTracking\) \{ _, tracking in\s*if tracking \{ requestInfoLanding\(note: "newSession", afterSummary: false\) \}/,
    );
  });

  it("첫 정보 행의 순서는 남은 거리 → 윗줄 → 상태 문장이고, 존재 판정이 렌더 조건과 짝이다", () => {
    expect(BEACON).toContain("[SheetFocus.remaining, .liveTop, .status].first(where: rowExists)");
    for (const render of [
      "focusTarget(distanceText(remaining), .remaining)",
      "focusTarget(distanceText(top), .liveTop)",
      ".foregroundStyle(.secondary), .status)",
    ]) {
      expect(BEACON, render).toContain(render);
    }
    const exists = body(BEACON, "private func rowExists(");
    expect(exists).toContain("case .remaining: return tracking && model.mode == .detail && !model.offRoute && model.remainingText != nil");
    expect(exists).toContain("case .liveTop: return tracking && model.mode == .detail && model.liveTopText != nil");
    expect(exists).toContain("case .status: return tracking && model.mode == .brief && !model.statusText.isEmpty");
    expect(exists).not.toMatch(/\bdefault:/);
    // 렌더 쪽 조건이 바뀌면 위 사본도 함께 바뀌어야 한다 — 렌더 조건 문자열을 함께 잠근다.
    expect(BEACON).toContain("if model.mode == .detail, !model.offRoute, let remaining = model.remainingText {");
    expect(BEACON).toContain("if model.mode == .detail {");
  });

  it("경로 조회 중이면 끝날 때까지, 커밋 요약이 있으면 그 발화가 끝날 때까지 기다린다(설계 리뷰 M1)", () => {
    expect(MODEL).toContain("private(set) var awaitingRoute = false");
    const request = body(BEACON, "private func requestInfoLanding(");
    expect(request).toContain("guard afterSummary || model.awaitingRoute else {");
    expect(request).toContain("Self.routeWaitLimit");
    expect(request).toContain("reason=timeout");
    expect(BEACON).toMatch(/\.onChange\(of: model\.awaitingRoute\) \{ _, awaiting in\s*if !awaiting \{ resolvePendingInfoLanding\(\) \}/);
    const resolve = body(BEACON, "private func resolvePendingInfoLanding(");
    expect(resolve).toContain("let expected = spokenUnits(model.statusText)");
    expect(resolve).toContain("lastFinishedAnnouncement != expected");
    expect(resolve).toContain("Self.summaryWaitLimitMs");
    expect(BEACON).toContain("UIAccessibility.announcementDidFinishNotification");
  });

  it("기다리는 동안 사용자가 커서를 옮겼으면 착지하지 않는다(설계 리뷰 M4)", () => {
    expect(BEACON).toMatch(
      /\.onChange\(of: focusedRow\) \{ _, new in\s*guard pendingInfoLanding != nil else \{ return \}\s*if new == \.title \{\s*pendingInfoLanding\?\.sawTitle = true\s*\} else if pendingInfoLanding\?\.sawTitle == true \{\s*pendingInfoLanding\?\.userMoved = true/,
    );
    expect(body(BEACON, "private func resolvePendingInfoLanding(")).toContain("reason=userMoved");
  });

  it("사용자 전이: 시트 안 버튼은 곧장, 자식 시트 안에서 고른 것은 그 시트가 닫힌 뒤 착지한다(설계 리뷰 M3)", () => {
    expect(BEACON).toContain('requestInfoLanding(note: "waypointRemoved", afterSummary: true)');
    expect(BEACON).toContain('requestInfoLanding(note: "rerouted", afterSummary: true)');
    for (const note of ["destinationChanged", "waypointChanged", "variantAdopted"]) {
      expect(BEACON, note).toContain(`landAfterDismiss = "${note}"`);
    }
    for (const sheet of ["$showRouteList", "$changeDestPresented", "$waypointPresented"]) {
      expect(BEACON, sheet).toContain(`.sheet(isPresented: ${sheet}, onDismiss: landAfterSubSheet)`);
    }
    // 도착 전이는 기다리던 착지·닫힌 뒤 착지를 먼저 버린다(종료 화면에서 끌어내리지 않게).
    expect(BEACON).toMatch(/landAfterDismiss = nil\s*showRouteList = false\s*clearPendingInfoLanding\(\)\s*landFocus\(\.arrived\)/);
  });

  it("소실 복구: 행 집합이 바뀌는 순간 커서가 사라진 정보 행에 있었으면 첫 정보 행으로(설계 리뷰 B1, A47 동형)", () => {
    expect(BEACON).toMatch(
      /\.onChange\(of: presentInfoRows\) \{ old, new in\s*guard let focused = focusedRow, old\.contains\(focused\), !new\.contains\(focused\),\s*model\.isTracking, model\.arrivalDest == nil else \{ return \}\s*requestInfoLanding\(note: "lost=\\\(focused\)", afterSummary: false\)/,
    );
  });

  it("착지 실행기는 2단 정본이고(3단 복제 금지) 배경·모달에선 시도하지 않으며 폴백 통지가 없다", () => {
    const land = body(BEACON, "private func landFocus(");
    expect(land).toContain("guard scenePhase == .active else {");
    expect(land).toContain("guard !subSheetPresented else {");
    expect(land).toContain("try? await Task.sleep(for: .milliseconds(400))");
    expect(land).not.toMatch(/scrollTo|\[600, 900, 1200\]|announce/);
    for (const key of ["landed=", "actual=", "attempts=", "waitedMs=", "vo="]) {
      expect(land, key).toContain(key);
    }
    expect(BEACON).toContain('guideDiagLog("sheetFocus sheet=beacon ');
  });

  it("남은 거리 행은 띠바와 같은 10m 갱신 값이고 같은 문장은 다시 대입하지 않는다(설계 리뷰 M2)", () => {
    const remaining = body(MODEL, "private func updateRemaining(");
    expect(remaining).toContain("let shownMeters = bandDistanceMeters ?? remainingMeters");
    expect(remaining).toContain('appLocalized("guide.remainingDistance", formatDistance(shownMeters))');
    expect(remaining).toContain("formatDistance((Int(target.meters.rounded()) + 5) / 10 * 10)");
    expect(remaining).toContain("if remainingText != text { remainingText = text }");
  });
});

describe("OutingSheet 착지 (E57 — 띠바 복귀만 상태 행으로, 계측)", () => {
  it("열림·띠바 복귀 착지는 상태 행이다(걸은 거리 행은 착지 대상이 아니다 — 나들이 spec 리뷰 M9, 위원장 판정 Q2)", () => {
    expect(OUTING).toContain('await land($statusFocused, "status")');
    expect(OUTING).not.toContain("minimizeFocused");
    expect(OUTING).not.toMatch(/distanceText\(model\.walkedLine\)\s*\.accessibilityFocused/);
  });

  it("착지 결과를 도보 시트와 같은 한 줄로 남긴다", () => {
    expect(OUTING).toContain('guideDiagLog("sheetFocus sheet=outing target=');
    expect(OUTING).toContain("landed=");
    expect(OUTING).toContain("vo=");
  });
});
