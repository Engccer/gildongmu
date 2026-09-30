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
  it("착지 바인딩은 옵셔널 하나이고 focusTarget 헬퍼 한 자리에만 붙는다(가시화 키 동반)", () => {
    expect(BEACON).toContain("@AccessibilityFocusState private var focusedRow: SheetFocus?");
    expect(BEACON).not.toMatch(/@AccessibilityFocusState private var \w+: Bool/);
    expect(BEACON.match(/\.accessibilityFocused\(/g) ?? []).toHaveLength(1);
    const helper = body(BEACON, "private func focusTarget<");
    expect(helper).toContain(".accessibilityFocused($focusedRow, equals: target)");
    expect(helper).toContain(".id(Self.focusId(target))");
  });

  it("시트 열림·띠바 복귀는 첫 정보 행을 요청한다 — 제목·접기 버튼 착지가 되살아나지 않는다(종료 화면은 도착 문장)", () => {
    const start = BEACON.indexOf(".task {");
    const task = BEACON.slice(start, BEACON.indexOf("\n        }\n", start));
    expect(task).toContain("landFocus(.arrived)");
    expect(task).toContain('requestInfoLanding(note: "open", summarySince: nil)');
    expect(task).not.toMatch(/\.title\b|\.minimize\b|returnedFromBand/);
    expect(BEACON).not.toMatch(/landTitleFocus|titleFocused|case minimize|case title/);
    // 띠바 복귀 분기 표지는 세 시트 어디에도 없다(E57 위원장 판정 Q1).
    for (const src of [BEACON, OUTING, TRANSIT]) expect(src).not.toContain("returnedFromBand");
    // 같은 콘텐츠 뷰 안에서 새 세션이 서는 경로(spec §3.5).
    expect(BEACON).toMatch(
      /\.onChange\(of: model\.isTracking\) \{ _, tracking in\s*if tracking \{ requestInfoLanding\(note: "newSession", summarySince: nil\) \}/,
    );
    // 첫 정보 행이 없으면 제목으로 올리지 않고 착지하지 않는다(a11y 감사 LOW).
    expect(body(BEACON, "private func landFirstInfoRow(")).toContain("reason=noInfoRow");
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

  it("경로 조회 중이면 커밋까지, 통지를 낸 전이면 그 시각 이후에 끝까지 발화된 통지까지 기다린다(설계 리뷰 M1, 증분 리뷰 M1)", () => {
    expect(MODEL).toContain("private(set) var awaitingRoute = false");
    const request = body(BEACON, "private func requestInfoLanding(");
    expect(request).toContain("guard summarySince != nil || model.awaitingRoute else {");
    expect(request).toContain("Self.routeWaitLimit");
    expect(request).toContain("reason=timeout");
    expect(BEACON).toMatch(/\.onChange\(of: model\.awaitingRoute\) \{ _, awaiting in\s*guard !awaiting, pendingInfoLanding != nil else \{ return \}\s*pendingInfoLanding\?\.summarySince = ProcessInfo\.processInfo\.systemUptime\s*resolvePendingInfoLanding\(\)/);
    const resolve = body(BEACON, "private func resolvePendingInfoLanding(");
    // 모델이 무엇을 게시했는지 문자열로 짐작하지 않는다 — 전이 시각 이후 끝까지 발화된 통지 하나.
    expect(resolve).not.toMatch(/statusText|spokenUnits/);
    expect(resolve).toContain("landingBox.lastCompletedAt.map { $0 >= (pending.summarySince ?? 0) }");
    expect(resolve).toContain("Self.summaryWaitLimitMs");
    expect(resolve).toContain("model.sessionKind == .car && model.listener == .driver");
    // 끊긴 발화는 세지 않고, 완료 기록은 관찰 대상이 아닌 상자에 쓴다(통지마다 시트가 다시 그려지지 않게, 코드 리뷰 m6).
    expect(BEACON).toMatch(/announcementDidFinishNotification\)\) \{ note in\s*guard \(note\.userInfo\?\[UIAccessibility\.announcementWasSuccessfulUserInfoKey\] as\? Bool\) == true else \{ return \}\s*landingBox\.lastCompletedAt = ProcessInfo\.processInfo\.systemUptime/);
    expect(BEACON).toContain("@State private var landingBox = LandingBox()");
  });

  it("기다리는 동안 사용자가 커서를 옮겼으면 착지하지 않는다 — VoiceOver 초점 이동 신호, 첫 이동 한 번은 시스템 배치(M4·a11y M2·증분 M3)", () => {
    expect(BEACON).toMatch(
      /elementFocusedNotification\)\) \{ _ in\s*guard Self\.isForeground, let pending = pendingInfoLanding else \{ return \}[\s\S]{0,200}if !pending\.systemPlacementSeen, elapsed <= Self\.systemPlacementWindow \{\s*pendingInfoLanding\?\.systemPlacementSeen = true\s*\} else if pending\.movedAfter == nil \{\s*pendingInfoLanding\?\.movedAfter = elapsed/,
    );
    expect(body(BEACON, "private func resolvePendingInfoLanding(")).toContain("reason=userMoved movedMs=");
  });

  it("사용자 전이: 시트 안 버튼은 곧장, 자식 시트 안에서 고른 것은 닫힌 뒤, 자동 채택은 커서가 버튼 위였을 때만", () => {
    expect(BEACON).toContain('requestInfoLanding(note: "waypointRemoved", summarySince: nil)');
    expect(BEACON).toMatch(/guard model\.offRouteEndedByReroute, pressed \|\| focusedRow == \.reroute else \{ return \}\s*requestInfoLanding\(note: "rerouted"/);
    // 재조회 버튼 표식은 이탈이 풀리면 결과와 무관하게 지운다(코드 리뷰 m9).
    expect(BEACON).toMatch(/let pressed = reroutePressed\s*reroutePressed = false/);
    for (const note of ["destinationChanged", "waypointChanged"]) {
      expect(BEACON, note).toContain(`landAfterDismiss = DismissLanding(note: "${note}", expectsSummary: model.awaitingRoute)`);
    }
    // 조망이 열려 있을 때만 닫힌 뒤 착지, 이미 닫혔으면 곧장(표식이 남지 않게 — 코드 리뷰 m2).
    expect(BEACON).toMatch(
      /if showRouteList \{\s*landAfterDismiss = DismissLanding\(note: "variantAdopted", expectsSummary: true\)\s*showRouteList = false\s*\} else \{\s*requestInfoLanding\(note: "variantAdopted"/,
    );
    for (const sheet of ["$showRouteList", "$changeDestPresented", "$waypointPresented", "$showPlaceDetail"]) {
      expect(BEACON, sheet).toContain(`.sheet(isPresented: ${sheet}, onDismiss: landAfterSubSheet)`);
    }
    // 도착 전이는 기다리던 착지를 버리고, 자식 시트가 떠 있으면 닫힌 뒤 도착 문장에.
    // 장소 상세도 닫는다(`stop()`이 dest를 비워 빈 모달이 된다, 증분 리뷰 M2) — 닫히는 시트가 있으면 닫힌 뒤 도착 문장에.
    expect(BEACON).toMatch(/let closing = showRouteList \|\| showPlaceDetail\s*showRouteList = false\s*showPlaceDetail = false\s*clearPendingInfoLanding\(\)[\s\S]{0,300}if closing \|\| changeDestPresented \|\| waypointPresented \{\s*landAfterDismiss = DismissLanding\(note: "arrived", expectsSummary: false, target: \.arrived\)/);
  });

  it("소실 복구: 행 집합이 바뀌는 순간 커서가 사라진 정보 행에 있었으면, 그 통지가 끝난 뒤 첫 정보 행으로(B1)", () => {
    expect(BEACON).toMatch(
      /\.onChange\(of: presentInfoRows\) \{ old, new in\s*guard let focused = focusedRow, old\.contains\(focused\), !new\.contains\(focused\),\s*model\.isTracking, model\.arrivalDest == nil else \{ return \}\s*requestInfoLanding\(note: "lost=\\\(focused\)", summarySince: ProcessInfo\.processInfo\.systemUptime\)/,
    );
  });

  it("배경 경계: 진행 중 착지·대기는 끊고 이월하며, 대입 전경 판정은 낡지 않은 실제 값이다(코드 리뷰 M1)", () => {
    expect(BEACON).toContain("private static var isForeground: Bool { UIApplication.shared.applicationState != .background }");
    expect(BEACON).toMatch(/case \.background:[\s\S]{0,200}let pendingCarry = pendingInfoLanding\.map \{ \$0\.movedAfter == nil \} \?\? false/);
    expect(BEACON).toMatch(/requestInfoLanding\(note: "deferred", summarySince: ProcessInfo\.processInfo\.systemUptime\)/);
    expect(BEACON).toMatch(/\.onDisappear \{\s*focusTask\?\.cancel\(\)\s*pendingTimeoutTask\?\.cancel\(\)\s*announcementWaitTask\?\.cancel\(\)/);
  });

  it("착지 실행기는 2단 정본이고(3단 복제 금지) 가시화 뒤 대입하며 폴백 통지가 없다", () => {
    const land = body(BEACON, "private func landFocus(");
    expect(land).toContain("guard Self.isForeground else {");
    expect(land).toContain("guard !subSheetPresented else {");
    expect(land).toContain("try? await Task.sleep(for: .milliseconds(400))");
    expect(land).toMatch(/guard Self\.isForeground else \{[\s\S]{0,200}landingBox\.proxy\?\.scrollTo\(Self\.focusId\(target\)\)\s*focusedRow = target/);
    expect(land).not.toMatch(/\[600, 900, 1200\]|announce|scenePhase/);
    for (const key of ["landed=", "actual=", "attempts=", "waitedMs=", "vo="]) {
      expect(land, key).toContain(key);
    }
    expect(BEACON).toContain('guideDiagLog("sheetFocus sheet=beacon ');
  });

  it("남은 거리 행은 10m 이상 변했을 때만 바뀌고 같은 문장은 다시 대입하지 않는다(설계 리뷰 M2·코드 리뷰 m5)", () => {
    const remaining = body(MODEL, "private func updateRemaining(");
    expect(remaining).toContain("let shownMeters = bandDistanceMeters ?? remainingMeters");
    expect(remaining).toContain('appLocalized("guide.remainingDistance", formatDistance(shownMeters))');
    expect(remaining).toContain("if shownWaypointMeters.map({ abs($0 - meters) >= 10 }) ?? true { shownWaypointMeters = meters }");
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
