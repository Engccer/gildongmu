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
const OUTPUT = readFileSync(join(DIR, "GuideSpeechOutput.swift"), "utf8");

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
    expect(task).toContain('requestInfoLanding(note: "open")');
    expect(task).not.toMatch(/\.title\b|\.minimize\b|returnedFromBand/);
    expect(BEACON).not.toMatch(/landTitleFocus|titleFocused|case minimize|case title/);
    // 띠바 복귀 분기 표지는 세 시트 어디에도 없다(E57 위원장 판정 Q1).
    for (const src of [BEACON, OUTING, TRANSIT]) expect(src).not.toContain("returnedFromBand");
    // 같은 콘텐츠 뷰 안에서 새 세션이 서는 경로(spec §3.5).
    expect(BEACON).toMatch(
      /\.onChange\(of: model\.isTracking\) \{ _, tracking in\s*if tracking \{ requestInfoLanding\(note: "newSession"\) \}/,
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

  it("경로 조회 중이면 커밋까지, 그다음 안내 모델의 통지가 모두 끝날 때까지 기다린다 — 시트는 통지 끝 신호를 직접 듣지 않는다(설계 리뷰 M1, 대기 계층 개정 §3.3.1)", () => {
    expect(MODEL).toContain("private(set) var awaitingRoute = false");
    const request = body(BEACON, "private func requestInfoLanding(");
    expect(request).toContain("private func requestInfoLanding(note: String) {");
    expect(request).toContain("Self.routeWaitLimit");
    expect(request).toContain("reason=timeout");
    expect(BEACON).toMatch(/\.onChange\(of: model\.awaitingRoute\) \{ _, awaiting in\s*guard !awaiting, pendingInfoLanding != nil else \{ return \}\s*resolvePendingInfoLanding\(\)/);
    const resolve = body(BEACON, "private func resolvePendingInfoLanding(");
    // 모델이 무엇을 게시했는지 시트가 짐작하지 않는다 — 모델이 여는 판정 하나.
    expect(resolve).not.toMatch(/statusText|spokenUnits/);
    expect(resolve).toContain("while waitsSpeech, !model.announcementsSettled {");
    expect(resolve).toContain("Self.speechWaitLimitMs");
    expect(resolve).toContain('speechWait = "cap open=\\(GuideSpeechOutput.openAnnouncements)"');
    expect(resolve).toContain("let waitsSpeech = UIAccessibility.isVoiceOverRunning && !driverChannel");
    expect(BEACON).toContain("private var driverChannel: Bool { model.sessionKind == .car && model.listener == .driver }");
    // 시트가 통지 끝 신호를 직접 들으면 앱의 아무 통지 끝이나 조건을 채운다(횡단 리뷰 F2). 전이별 통지 짐작 인자도 없다.
    expect(BEACON).not.toMatch(/announcementDidFinishNotification|summarySince|expectsSummary|lastCompletedAt/);
    // 판정은 모델: 톤 뒤로 미룬 문장 없음 ∧ 게시한 VoiceOver 통지가 끝남(장부).
    expect(MODEL).toContain(
      "var announcementsSettled: Bool { !deferredAnnouncer.hasPending && GuideSpeechOutput.announcementsFinished }",
    );
    // 장부는 안내 VoiceOver 게시의 한 창구가 적고, 끝 신호는 문장으로 짝을 맞춘다(끝까지든 끊겼든).
    const post = body(OUTPUT, "static func postVoiceOver(");
    expect(post).toMatch(/if UIAccessibility\.isVoiceOverRunning \{\s*observeAnnouncementFinishes\(\)\s*ledger\.posted\(text,/);
    expect(OUTPUT).toContain("UIAccessibility.announcementStringValueUserInfoKey");
    // 끝 신호의 문장 형은 실측이 없다 — 두 형을 다 받는다(설계 리뷰 MAJOR 2: 어긋나면 모든 착지가 상한까지 기다린다).
    expect(OUTPUT).toContain("let text = (value as? String) ?? (value as? NSAttributedString)?.string");
    expect(OUTPUT).not.toContain("announcementWasSuccessfulUserInfoKey");
    // 장부 만료는 착지 대기 상한보다 길어야 짝 실패가 `cap open=1`로 드러난다(접근성 감사 M1 — 같으면 거짓 `settled`).
    const ledger = readFileSync(join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/GuideAnnouncementLedger.swift"), "utf8");
    const expiry = Number(ledger.match(/public static let expirySeconds = ([\d.]+)/)?.[1]);
    const limitMs = Number(BEACON.match(/private static let speechWaitLimitMs = ([\d_]+)/)?.[1].replace(/_/g, ""));
    expect(expiry * 1000).toBeGreaterThan(limitMs);
    // 안내 문장을 내는 자리(세 모델·코디네이터·안내 시트)의 VoiceOver 게시는 이 창구를 지난다(직접 게시가 생기면 장부가 모른다,
    // spec 준수 리뷰 m3·코드 품질 리뷰 n4).
    for (const f of [
      "BeaconModel.swift", "TransitGuideModel.swift", "OutingModel.swift", "GuideSessionCoordinator.swift",
      "BeaconTrackingSheet.swift", "TransitTrackingSheet.swift", "OutingSheet.swift", "GuideOverviewSheet.swift",
    ]) {
      const src = readFileSync(join(DIR, f), "utf8");
      expect(src, f).not.toMatch(/AccessibilityNotification\.Announcement|UIAccessibility\.post\(notification: \.announcement/);
    }
  });

  it("기다리는 동안 사용자가 커서를 옮겼으면 착지하지 않는다 — VoiceOver 초점 이동 신호, 첫 이동 한 번은 시스템 배치(M4·a11y M2·증분 M3)", () => {
    expect(BEACON).toMatch(
      /elementFocusedNotification\)\) \{ _ in\s*guard Self\.isForeground, let pending = pendingInfoLanding else \{ return \}[\s\S]{0,200}if !pending\.systemPlacementSeen, elapsed <= Self\.systemPlacementWindow \{\s*pendingInfoLanding\?\.systemPlacementSeen = true\s*\} else if pending\.movedAfter == nil \{\s*pendingInfoLanding\?\.movedAfter = elapsed/,
    );
    expect(body(BEACON, "private func resolvePendingInfoLanding(")).toContain("reason=userMoved movedMs=");
  });

  it("사용자 전이: 시트 안 버튼은 곧장, 자식 시트 안에서 고른 것은 닫힌 뒤, 자동 채택은 커서가 버튼 위였을 때만", () => {
    expect(BEACON).toContain('requestInfoLanding(note: "waypointRemoved")');
    expect(BEACON).toMatch(/guard model\.offRouteEndedByReroute, pressed \|\| focusedRow == \.reroute else \{ return \}\s*requestInfoLanding\(note: "rerouted"/);
    // 재조회 버튼 표식은 이탈이 풀리면 결과와 무관하게 지운다(코드 리뷰 m9).
    expect(BEACON).toMatch(/let pressed = reroutePressed\s*reroutePressed = false/);
    for (const note of ["destinationChanged", "waypointChanged"]) {
      expect(BEACON, note).toContain(`landAfterDismiss = DismissLanding(note: "${note}")`);
    }
    // 조망이 열려 있을 때만 닫힌 뒤 착지, 이미 닫혔으면 곧장(표식이 남지 않게 — 코드 리뷰 m2).
    expect(BEACON).toMatch(
      /if showRouteList \{\s*landAfterDismiss = DismissLanding\(note: "variantAdopted"\)\s*showRouteList = false\s*\} else \{\s*requestInfoLanding\(note: "variantAdopted"/,
    );
    for (const sheet of ["$showRouteList", "$changeDestPresented", "$waypointPresented", "$showPlaceDetail"]) {
      expect(BEACON, sheet).toContain(`.sheet(isPresented: ${sheet}, onDismiss: landAfterSubSheet)`);
    }
    // 도착 전이는 기다리던 착지를 버리고, 자식 시트가 떠 있으면 닫힌 뒤 도착 문장에.
    // 장소 상세도 닫는다(`stop()`이 dest를 비워 빈 모달이 된다, 증분 리뷰 M2) — 닫히는 시트가 있으면 닫힌 뒤 도착 문장에.
    expect(BEACON).toMatch(/let closing = showRouteList \|\| showPlaceDetail\s*showRouteList = false\s*showPlaceDetail = false\s*clearPendingInfoLanding\(\)[\s\S]{0,300}if closing \|\| changeDestPresented \|\| waypointPresented \{\s*landAfterDismiss = DismissLanding\(note: "arrived", target: \.arrived\)/);
  });

  it("소실 복구: 행 집합이 바뀌는 순간 커서가 사라진 정보 행에 있었으면, 그 통지가 끝난 뒤 첫 정보 행으로(B1)", () => {
    expect(BEACON).toMatch(
      /\.onChange\(of: presentInfoRows\) \{ old, new in\s*guard let focused = focusedRow, old\.contains\(focused\), !new\.contains\(focused\),\s*model\.isTracking, model\.arrivalDest == nil else \{ return \}\s*requestInfoLanding\(note: "lost=\\\(focused\)"\)/,
    );
  });

  it("배경 경계: 진행 중 착지·대기는 끊고 이월하며, 복귀 착지는 모델의 복귀 처리 뒤에 시작한다(코드 리뷰 M1, 횡단 리뷰 F1)", () => {
    expect(BEACON).toContain("private static var isForeground: Bool { UIApplication.shared.applicationState != .background }");
    expect(BEACON).toMatch(/guard phase == \.background else \{ return \}[\s\S]{0,200}let pendingCarry = pendingInfoLanding\.map \{ \$0\.movedAfter == nil \} \?\? false/);
    // 시트의 scenePhase `.active`가 아니라 모델 신호에서 — 순서가 보장되지 않아 상환 게시 전에 착지할 수 있다.
    expect(BEACON).toMatch(/\.onChange\(of: model\.foregroundReturnSeq\) \{\s*guard let target = deferredLanding else \{ return \}[\s\S]{0,300}requestInfoLanding\(note: "deferred"\)/);
    expect(BEACON).not.toMatch(/case \.active:/);
    // 이월된 도착·걸음 요약 착지도 복귀 상환(.high)이 끝난 뒤에(접근성 감사 M3).
    expect(BEACON).toMatch(/requestInfoLanding\(note: "deferred"\)\s*\} else \{\s*landAfterSpeech\(target, note: "deferred"\)/);
    expect(body(BEACON, "private func landAfterSpeech(")).toContain("!model.announcementsSettled");
    // 모델은 복귀 분기의 끝(조기 반환 포함)에서 신호를 올린다.
    expect(MODEL).toMatch(/case \.active:\s*\/\/[^\n]*\n\s*defer \{ foregroundReturnSeq \+= 1 \}/);
    expect(BEACON).toMatch(/\.onDisappear \{\s*focusTask\?\.cancel\(\)\s*pendingTimeoutTask\?\.cancel\(\)\s*announcementWaitTask\?\.cancel\(\)/);
  });

  it("착지 실행기는 2단 정본이고(3단 복제 금지) 가시화 뒤 대입하며 폴백 통지가 없다", () => {
    const land = body(BEACON, "private func landFocus(");
    expect(land).toContain("guard Self.isForeground else {");
    expect(land).toContain("guard !subSheetPresented else {");
    expect(land).toContain("try? await Task.sleep(for: .milliseconds(400))");
    expect(land).toMatch(/guard Self\.isForeground else \{[\s\S]{0,200}landingBox\.proxy\?\.scrollTo\(Self\.focusId\(target\)\)\s*focusedRow = target/);
    expect(land).not.toMatch(/\[600, 900, 1200\]|announce|scenePhase/);
    for (const key of ["landed=", "actual=", "attempts=", "waitedMs=", "speechWait=", "vo="]) {
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
