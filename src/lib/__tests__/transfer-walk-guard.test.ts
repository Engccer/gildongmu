import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E73 환승 도보 인계의 배선 가드(spec `docs/superpowers/specs/2026-10-19-e73-transfer-walk-design.md`).
 * 판정(대상·거리·재개 상태)은 Kit `TransitTransferWalkTests`가, 여기는 앱 배선의 순서·보존·문장 틀을 잠근다 —
 * 뷰·모델 계층은 테스트 레인이 없어 소스 가드가 유일한 검출 수단이다.
 */

const ROOT = join(__dirname, "../../..");
const DIR = join(ROOT, "ios/Gildongmu/Directions");
const read = (path: string) => readFileSync(path, "utf8");
const LOCALES = ["ko", "en", "es", "fr", "it", "ja"] as const;

function functionBody(source: string, name: string): string {
  const at = source.indexOf(`func ${name}(`);
  if (at < 0) throw new Error(`func ${name}을 찾지 못했다`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`func ${name}의 끝을 찾지 못했다`);
}

const transit = () => read(join(DIR, "TransitGuideModel.swift"));
const coordinator = () => read(join(DIR, "GuideSessionCoordinator.swift"));
const beacon = () => read(join(DIR, "BeaconModel.swift"));

describe("E73 환승 도보 — 대중교통 모델", () => {
  it("「다음 구간」은 리듀서를 미리 돌려 환승 도보면 전진을 커밋하지 않고 넘긴다(D3)", () => {
    const body = functionBody(transit(), "completeOrAdvance");
    const dryRun = body.indexOf("transitGuideStep(state: state, input: .advance, route: route, now: nowMs())");
    const target = body.indexOf("transitTransferWalkTarget(route, legIndex: nextIndex)");
    const passed = body.indexOf("GuideSession.shared.transitPassedPrewalk()");
    const handoff = body.indexOf("GuideSession.shared.transitTransferWalk(");
    const commit = body.indexOf("dispatch(.advance)");
    expect(dryRun).toBeGreaterThan(-1);
    expect(dryRun).toBeLessThan(target);
    expect(target).toBeLessThan(passed);
    // 넘어간다 = 탔다(A68) — 전진을 커밋하지 않으니 인계 앞에서 알린다(리뷰 L1).
    expect(passed).toBeGreaterThan(-1);
    expect(passed).toBeLessThan(handoff);
    // 실승차 판정 재료: 걷기가 있는 전진은 대상 여부와 무관하게 직선 거리와 판정을 남긴다(spec §5-3).
    expect(body).toContain("meters=\\(meters) target=\\(target == nil ? 0 : 1)");
    expect(body.indexOf("transitTransferWalkMeters(route, legIndex: nextIndex)")).toBeLessThan(passed);
    // 대상 여부와 무관하게 — 로그는 `if let target {` 밖, 앞이다(안으로 옮기면 문턱에 걸린 환승의 로그가 사라진다).
    expect(body.indexOf("meters=\\(meters) target=")).toBeLessThan(body.indexOf("if let target {"));
    // 넘긴 뒤 곧장 반환한다 — 전진을 커밋하면 즉시 창구의 「도보 N분 이동 후 …」가 나간다.
    expect(body.slice(handoff, commit)).toMatch(/\)\)\s*return\s*\}/);
    expect(handoff).toBeLessThan(commit);
    // 마지막 구간(final: true)은 대상이 아니다 — E34·여정 인계 불변.
    expect(body).toContain("case let .legAdvanced(nextIndex, final: false)? =");
  });

  it("인계 정지는 정지음 없이 여정 훅 셋을 보존한다(D4)", () => {
    const body = functionBody(transit(), "stopForTransferWalk");
    expect(body).toMatch(/onJourneyStopped = nil\s*stop\(\)/);
    expect(body).not.toContain("playStopTone");
    for (const restore of [
      "onJourneyStopped = stopped",
      "onJourneyRideCompleted = rideCompleted",
      "journeyNextIsWalk = nextIsWalk",
    ]) {
      expect(body.indexOf(restore), restore).toBeGreaterThan(body.indexOf("stop()"));
    }
  });

  it("재개는 처음 경로 전체로 그 구간의 대기 국면부터, 걸었으면 그 구간 도보만 지운다(D1·D5)", () => {
    const start = functionBody(transit(), "startAfterPrewalk");
    expect(start).toContain("prewalkCompleted ? withoutWalkBefore(guideRoute, legIndex: startLeg) : guideRoute");
    expect(start).not.toContain("buildTransitGuideRoute");
    const begin = functionBody(transit(), "beginSession");
    expect(begin).toContain("state = initTransitGuide(route: guideRoute, startingAt: startLeg, now: nowMs())");
    // 재개는 「안내를 시작합니다. 탑승 구간 N개.」를 다시 말하지 않는다.
    expect(begin).toMatch(/var parts = startLeg > 0 \? \[waitContextText\(first, isCurrentLeg: true\)\] : \[/);
    expect(begin).toContain("let first = guideRoute.legs[state?.legIndex ?? 0]");
  });

  it("탔다(A68)는 세션이 시작한 구간 기준이다(D8)", () => {
    expect(functionBody(transit(), "beginSession")).toContain("sessionStartLeg = startLeg");
    expect(functionBody(transit(), "dispatch")).toContain("s.legIndex > sessionStartLeg");
    // 경로 교체는 0번 구간부터 새로 연다 — 시작 구간도 함께 0이다.
    const change = functionBody(transit(), "changeRoute");
    expect(change.indexOf("sessionStartLeg = 0")).toBeGreaterThan(-1);
    expect(change.indexOf("sessionStartLeg = 0")).toBeLessThan(change.indexOf("state = initTransitGuide(route: guideRoute, now: nowMs())"));
  });
});

describe("E73 환승 도보 — 세션 소유자", () => {
  it("정지 → 600ms 대기(prewalkTask) → 점유 재확인 → A25 연결 순서(D4)", () => {
    const body = functionBody(coordinator(), "transitTransferWalk");
    const order = [
      "transit.stopForTransferWalk()",
      "prewalkTask?.cancel()",
      "prewalkTask = Task",
      "Task.sleep(for: .milliseconds(600))",
      "guard !self.isActive else",
      "self.launchPrewalk(context)",
      "self.beginBeacon(",
    ].map((needle) => [needle, body.indexOf(needle)] as const);
    for (const [needle, at] of order) expect(at, needle).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) expect(order[i - 1][1], order[i][0]).toBeLessThan(order[i][1]);
    // 대상 구간이 재개 지점이다.
    expect(body).toContain("startLeg: handoff.legIndex");
    // 여정이면 버린 인계가 세션 없는 running에 남지 않는다(리뷰 L2).
    const abandoned = body.slice(body.indexOf("guard !self.isActive else"), body.indexOf("self.launchPrewalk(context)"));
    expect(abandoned).toMatch(/case \.running\(\.transit\) = journey\.phase \{\s*self\.advanceJourney\(\.stageEnded\(\.startFailed\), token: journey\.token\)/);
  });

  it("환승 도보 시작 문장만 .high다 — 시트가 내려가 커서가 옮겨 간 자리(접근성 감사 M1)", () => {
    expect(functionBody(coordinator(), "launchPrewalk")).toMatch(
      /transitPrewalkStartLine\([^]*\)\),\s*highPriority: context\.isTransfer, speechClass: \.actionable\)/,
    );
    expect(transit()).toContain("func announceExternal(_ message: String, highPriority: Bool, speechClass: GuideSpeechClass) {");
  });

  it("연결의 끝이 시작 구간을 넘긴다(도착·시작 실패·환승 도보 위치 상실)", () => {
    const body = functionBody(coordinator(), "endPrewalk");
    expect(body.match(/guideRoute: context\.guideRoute, startLeg: context\.startLeg,/g)).toHaveLength(1);
    expect(body).toContain("dest: context.dest, accessible: context.accessible, prewalkCompleted: true)");
    expect(body).toContain("resumeTransitAfterWalkSpeech(context, prewalkCompleted: false, sheetGapMs: 0,");
    const resume = functionBody(coordinator(), "resumeTransitAfterWalkSpeech");
    expect(resume).toContain("guideRoute: context.guideRoute, startLeg: context.startLeg,");
    expect(resume).toContain("prewalkCompleted: prewalkCompleted)");
    // 통지가 끝난 뒤 연다 — 대중교통 시작 통지가 원인·다리 문장을 끊지 않게.
    expect(resume.indexOf("self.beacon.announcementsSettled")).toBeLessThan(resume.indexOf("self.transit.startAfterPrewalk("));
  });

  it("표식은 환승 여부를 기본값 없이 밝힌다(D6)", () => {
    expect(beacon()).toMatch(/func markPrewalk\(target: TransitLabel, transfer: Bool\) \{/);
    // 한 줄 호출이다(인자 안에 괄호가 있어 줄 단위로 본다).
    const calls = coordinator().match(/beacon\.markPrewalk\(.*$/gm) ?? [];
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toContain("transfer:");
    expect(functionBody(coordinator(), "launchPrewalk")).toContain(
      "beacon.markPrewalk(target: context.station, transfer: context.isTransfer)",
    );
    // 꼬리를 가르는 세 줄(리뷰 L3 — 하나라도 고정되면 환승 정지 꼬리가 「시작하지 않았습니다」로 돌아간다).
    expect(coordinator()).toMatch(/var isTransfer: Bool \{ startLeg > 0 \}/);
    expect(functionBody(beacon(), "markPrewalk")).toMatch(/^\{\s*prewalkTarget = target\s*prewalkIsTransfer = transfer\s*\}$/);
    expect(beacon()).toMatch(
      /private var prewalkStopTail: PrewalkStopTail\? \{\s*guard prewalkTarget != nil else \{ return nil \}\s*return prewalkIsTransfer \? \.transitAlsoEnded : \.transitNotStarted\s*\}/,
    );
    // 표식은 함께 서고 함께 지워진다.
    expect(beacon().match(/^\s+(?:self\.)?prewalkIsTransfer = false$/gm)).toHaveLength(3);
  });
});

describe("E73 환승 도보 — 걷는 중 위치 상실은 그 구간 승차 대기로(위원장 판정 2026-10-19)", () => {
  it("도보 모델은 위치 상실을 다른 정지와 갈라 알린다", () => {
    expect(beacon()).toContain("enum EndReason { case arrived, userStopped, startFailed, locationLost, ended }");
    const body = functionBody(beacon(), "stopAndFail");
    // 사유는 stop() 앞에 — stop()이 소비한다.
    expect(body.indexOf("pendingEndReason = .locationLost")).toBeGreaterThan(-1);
    expect(body.indexOf("pendingEndReason = .locationLost")).toBeLessThan(body.indexOf("stopLeavingSummary("));
    // 환승 도보 꼬리만 재개 꼬리로 바뀐다(A25 꼬리·여정 접근 도보는 불변).
    expect(body).toMatch(
      /let prewalkTail = journeyChain == nil\s*\? \(prewalkStopTail == \.transitAlsoEnded \? \.transitResumes : prewalkStopTail\) : nil/,
    );
    // [안내 종료]는 둘 다 끝냄 그대로(위원장 판정).
    const stopByUser = functionBody(beacon(), "stopByUser");
    expect(stopByUser).toContain("let prewalkTail = prewalkStopTail");
    expect(stopByUser).not.toContain("transitResumes");
  });

  it("재개 꼬리는 사유와 한 통지·한 상태 줄이다(백그라운드에서 버려지면 복귀 상환이 상태 줄로 갚는다)", () => {
    expect(functionBody(beacon(), "fail")).toMatch(
      /statusText = prewalkTail\.map \{ prewalkStopText\(\$0, reason: appLocalized\(key\)\) \} \?\? appLocalized\(key\)/,
    );
    expect(functionBody(beacon(), "prewalkStopText")).toContain(
      'case .transitResumes: appLocalized("ios.beacon.transferWalkLostWith", reason)',
    );
  });

  it("코디네이터는 환승 도보의 위치 상실만 그 구간 대기로 다시 연다(A25 승차 전 도보는 전체 종료 그대로)", () => {
    const body = functionBody(coordinator(), "endPrewalk");
    const resume = body.indexOf("case .locationLost where context.isTransfer:");
    const end = body.indexOf("case .userStopped, .locationLost, .ended:");
    expect(resume).toBeGreaterThan(-1);
    expect(resume).toBeLessThan(end);
    // 걷던 중이었다 — 도착과 같이 그 구간 도보 문맥을 지운다(「도보 N분 이동 후」를 말하지 않는다). 걷던 시트가 내려갈 틈 600ms.
    expect(body.slice(resume, end)).toContain(
      "resumeTransitAfterWalkSpeech(context, prewalkCompleted: true, sheetGapMs: 600,",
    );
    expect(coordinator()).toContain("case .locationLost, .ended: self = .ended");
  });

  it.each(LOCALES)("%s: 재개 꼬리 틀은 두 문장이고 정지 꼬리와 다르다", (locale) => {
    const f = JSON.parse(read(join(ROOT, `ios/i18n/ios-extra/${locale}.json`))).ios.beacon as Record<string, string>;
    expect(f.transferWalkLostWith.startsWith(locale === "ja" ? "{reason}。" : "{reason}. ")).toBe(true);
    expect(f.transferWalkLostWith).toMatch(/[.。]$/);
    expect(f.transferWalkLostWith).not.toBe(f.transferWalkCancelledWith);
  });

  it("렌더: 권한 상실(ko)", () => {
    const f = JSON.parse(read(join(ROOT, "ios/i18n/ios-extra/ko.json"))).ios.beacon as Record<string, string>;
    expect(f.transferWalkLostWith.replace("{reason}", "위치 권한이 필요합니다")).toBe(
      "위치 권한이 필요합니다. 도보 안내를 멈추고 승차 대기로 넘어갑니다.",
    );
  });
});

describe("E73 환승 도보 — 정지 꼬리 문장(D6)", () => {
  const frames = (locale: string) =>
    JSON.parse(read(join(ROOT, `ios/i18n/ios-extra/${locale}.json`))).ios.beacon as Record<string, string>;

  it.each(LOCALES)("%s: 환승 도보 꼬리 틀은 A25 틀과 같은 모양의 두 문장이다", (locale) => {
    const frame = frames(locale).transferWalkCancelledWith;
    expect(frame.startsWith(locale === "ja" ? "{reason}。" : "{reason}. ")).toBe(true);
    expect(frame).toMatch(/[.。]$/);
    expect(frame).not.toBe(frames(locale).prewalkCancelledWith);
  });

  it("렌더: 사용자 정지(ko·en)", () => {
    const render = (locale: string) =>
      frames(locale).transferWalkCancelledWith.replace("{reason}", frames(locale).stoppedJoin);
    expect(render("ko")).toBe("거리 추적을 종료했습니다. 대중교통 안내도 종료했습니다.");
    expect(render("en")).toBe("Distance tracking stopped. Transit guidance has also ended.");
  });
});
