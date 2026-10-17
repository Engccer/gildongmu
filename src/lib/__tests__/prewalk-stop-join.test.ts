import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A54: 승차 전 도보를 직접 끝낼 때의 결합 문장과 세션 중 권한 철회 사유.
const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const LOCALES = ["ko", "en", "es", "fr", "it", "ja"] as const;

function beaconKeys(locale: string): Record<string, string> {
  return JSON.parse(read(`ios/i18n/ios-extra/${locale}.json`)).ios.beacon;
}

describe("승차 전 도보 종료 결합 문장(A54)", () => {
  it.each(LOCALES)("%s: 결합용 키는 정지 문장에서 마침표만 뗀 같은 문장이다", (locale) => {
    const keys = beaconKeys(locale);
    expect(keys.stoppedJoin).toBe(keys.stopped.slice(0, -1));
    expect(keys.stoppedJoin).not.toMatch(/[.。]$/);
  });

  it.each(LOCALES)("%s: 문장 틀 키는 사유 뒤에 마침표를 찍고 대중교통 미시작 문장을 잇는 두 문장이다(위원장 판정)", (locale) => {
    const cancelled: string = JSON.parse(read(`messages/${locale}.json`)).transitGuide.prewalkCancelled;
    const frame = beaconKeys(locale).prewalkCancelledWith;
    expect(frame).toBe(locale === "ja" ? `{reason}。${cancelled}` : `{reason}. ${cancelled}`);
  });

  it("사용자 정지는 도보 모델이 마침표 없는 정지 키를 문장 틀에 넣어 .high 두 문장으로 낸다(정지음 뒤, 화면 꺼짐에도 전달)", () => {
    const beacon = read("ios/Gildongmu/Directions/BeaconModel.swift");
    const start = beacon.indexOf("    func stopByUser() {");
    const body = beacon.slice(start, beacon.indexOf("\n    }\n", start));
    // stop()이 prewalkTarget을 지우므로 그 앞에서 캡처한다.
    expect(body.indexOf("let prewalk = prewalkTarget != nil")).toBeGreaterThan(-1);
    expect(body.indexOf("let prewalk = prewalkTarget != nil")).toBeLessThan(body.indexOf("stopLeavingSummary("));
    // "정지음 뒤"는 정지음이 있어야 성립한다(재리뷰 NIT-2 변이 생존).
    expect(body).toContain("stopLeavingSummary(playStopTone: true, text: text)");
    expect(body).toMatch(
      /\} else if prewalk \{[\s\S]*announce\(\s*appLocalized\("ios\.beacon\.prewalkCancelledWith", appLocalized\("ios\.beacon\.stoppedJoin"\)\),\s*highPriority: true, speechClass: \.actionable\)/,
    );
  });

  it("코디네이터는 사용자 정지·실패 종료에 문장을 내지 않는다 — 세션 전 대중교통 창구는 정지음과 겹치고 백그라운드에서 버린다", () => {
    const source = read("ios/Gildongmu/Directions/GuideSessionCoordinator.swift");
    const tail = source.slice(source.indexOf("        case .userStopped, .ended:"), source.indexOf("    /// 낡은 연결 폐기"));
    expect(tail.length).toBeGreaterThan(0);
    expect(tail).not.toContain("announceExternal");
    expect(source).not.toContain("prewalkCancelledWith");
  });

  it.each(LOCALES)("%s: 문장 틀에 들어가는 사유 키는 마침표로 끝나지 않는다(겹치면 '..')", (locale) => {
    const beacon: Record<string, string> = JSON.parse(read(`messages/${locale}.json`)).beacon;
    for (const reason of [beaconKeys(locale).stoppedJoin, beacon.denied, beacon.reduced]) {
      expect(reason, locale).toBeTruthy();
      expect(reason, locale).not.toMatch(/[.。]$/);
    }
  });

  it("렌더: 사용자 정지(ko·en)와 권한 상실(ko) 최종 문장", () => {
    const render = (locale: string, reason: string) =>
      beaconKeys(locale).prewalkCancelledWith.replace("{reason}", reason);
    expect(render("ko", beaconKeys("ko").stoppedJoin)).toBe("거리 추적을 종료했습니다. 대중교통 안내는 시작하지 않았습니다.");
    expect(render("en", beaconKeys("en").stoppedJoin)).toBe("Distance tracking stopped. Transit guidance was not started.");
    const denied: string = JSON.parse(read("messages/ko.json")).beacon.denied;
    expect(render("ko", denied)).toBe("위치 권한이 필요합니다. 대중교통 안내는 시작하지 않았습니다.");
  });

  it("세션 중 CLError.denied는 권한 거부 사유로 끝낸다(신호 약함 아님)", () => {
    const source = read("ios/Gildongmu/Directions/BeaconModel.swift");
    const start = source.indexOf("private func handle(locationError code: CLError.Code)");
    const body = source.slice(start, source.indexOf("\n    }\n", start));
    expect(body).toMatch(/case \.denied:[\s\S]*?stopAndFail\(with: \.denied, key: "beacon\.denied", resolution: \.settings\)/);
    expect(body).not.toContain('"beacon.weak"');
  });
});

// A67: 승차 전 도보를 시작하지 못하면 다리 문장은 도보 모델이 원인 문장과 한 통지로 내고, 대중교통 시작은 그 통지를 기다린다
// (E70 판정 27 여정 접근 도보와 같은 방식). 대중교통 창구로 따로 내면 그 재생기는 세션 전이라 백그라운드에서 버려지고, 전경에선
// 같은 턴에 게시돼 원인 문장을 끊었다.
describe("승차 전 도보 시작 실패 다리 문장(A67)", () => {
  it.each(LOCALES)("%s: 문장 틀은 사유 뒤에 기존 다리 문장을 그대로 잇는 두 문장이다(새 문장 없음)", (locale) => {
    const bridge: string = JSON.parse(read(`messages/${locale}.json`)).transitGuide.prewalkUnavailable;
    const frame = beaconKeys(locale).prewalkUnavailableWith;
    expect(frame).toBe(locale === "ja" ? `{reason}。${bridge}` : `{reason}. ${bridge}`);
  });

  it.each(LOCALES)("%s: 시작 실패 사유 키 셋은 마침표로 끝나지 않는다", (locale) => {
    const beacon: Record<string, string> = JSON.parse(read(`messages/${locale}.json`)).beacon;
    for (const reason of [beacon.weak, beacon.denied, beacon.reduced]) {
      expect(reason, locale).toBeTruthy();
      expect(reason, locale).not.toMatch(/[.。]$/);
    }
  });

  it("도보 모델: 시작 중 실패면 통지에만 다리 문장을 붙여 .high로 낸다(상태 줄은 원인만, 여정 접근 도보는 판정 27 갈래)", () => {
    const beacon = read("ios/Gildongmu/Directions/BeaconModel.swift");
    const start = beacon.indexOf("    private func fail(");
    const body = beacon.slice(start, beacon.indexOf("\n    }\n", start));
    // stopAndFail의 prewalk 술어와 같은 판정 + 시작 중(걷던 중 끊김은 stopAndFail의 「대중교통 안내는 시작하지 않았다」 꼬리)
    expect(body).toContain("let prewalkBridge = starting && prewalkTarget != nil && journeyChain == nil");
    expect(body).toMatch(
      /announce\(\s*journeyBridge \? appLocalized\("ios\.journey\.accessFailedWith", appLocalized\(key\)\)\s*: prewalkBridge \? appLocalized\("ios\.beacon\.prewalkUnavailableWith", appLocalized\(key\)\) : statusText,\s*highPriority: highPriority \|\| journeyBridge \|\| prewalkBridge, speechClass: \.actionable\)/,
    );
    // 다리 문장 키는 통지 인자에만 한 번 나온다(상태 줄은 대중교통이 끝난 뒤 거짓 진행형이 된다)
    expect(body.match(/prewalkUnavailableWith/g)).toHaveLength(1);
  });

  it("코디네이터: 시작 실패 갈래는 대중교통 창구로 말하지 않고, 대중교통 시작을 도보 통지 끝(상한 있음)까지 미룬다", () => {
    const source = read("ios/Gildongmu/Directions/GuideSessionCoordinator.swift");
    const fn = source.indexOf("    private func endPrewalk(");
    const from = source.indexOf("        case .startFailed:", fn);
    const branch = source.slice(from, source.indexOf("        case .userStopped, .ended:", from));
    expect(fn).toBeGreaterThan(-1);
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).not.toContain("announceExternal");
    expect(source).not.toContain("transitGuide.prewalkUnavailable");
    // 취소 가능한 연결 Task 안에서(다른 시작·teardown의 cancelPrewalk가 끊는다) 기다린 뒤 시작한다
    expect(branch).toMatch(
      /prewalkTask = Task \{ @MainActor \[weak self\] in[\s\S]*if UIAccessibility\.isVoiceOverRunning \{[\s\S]*while !self\.beacon\.announcementsSettled, waited < Self\.walkSpeechWaitLimitMs/,
    );
    expect(branch.indexOf("announcementsSettled")).toBeLessThan(branch.indexOf("self.transit.startAfterPrewalk("));
    expect(branch).toMatch(/guard !Task\.isCancelled else \{ return \}\s*self\.transit\.startAfterPrewalk\(/);
    // 여정의 대중교통 단계인데 세션이 서지 않으면 세션 없는 running(.transit)에 멈추지 않게 실패로 넘긴다(Task 안, 시작 뒤)
    expect(branch).toMatch(
      /self\.transit\.startAfterPrewalk\([\s\S]*?prewalkCompleted: false\)[\s\S]*if !self\.transit\.isTracking, let journey = self\.journey, case \.running\(\.transit\) = journey\.phase \{[\s\S]*self\.advanceJourney\(\.stageEnded\(\.startFailed\), token: journey\.token\)/,
    );
  });
});
