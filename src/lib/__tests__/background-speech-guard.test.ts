import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 백그라운드 음성 안내(E53, spec `docs/superpowers/specs/2026-09-30-background-speech-design.md`) 소스 가드.
 * 판정(채널 술어·분류·대기 칸)은 Kit 테스트가 잠그고, 여기는 컴파일러가 못 잡는 배선과 **정식판 불변**을 잠근다:
 *
 * 1. 안내의 기기 음성(`speakGuidance`)은 공유 출력 한 곳과 자동차 운전자 채널 한 곳에서만 부른다 — 다른 자리가
 *    부르면 토글·분류를 우회해 토글을 꺼도 백그라운드 음성이 나간다.
 * 2. 토글 실효값은 한 함수(`GuideSpeechOutput.backgroundSpeechEnabled`)이고 저장값을 Kit `BackgroundSpeech.isEnabled`로
 *    푼다. 봉인 플래그(`experimentalBackgroundSpeechEnabled`)는 2.0(2026-10-01)에서 졸업했다 — 식별자가 남지 않아야
 *    한다. 토글 끔은 종전 분기와 같다(Kit `GuideSpeechChannelTests.releaseEquivalenceForBeaconAndTransit`).
 * 3. 설정 행은 한 자리이고 실험 조건(`#if`) 밖에 있다.
 * 4. 세 안내 모델의 `post`는 채널 술어를 지나고, 분류 인자(`speechClass`)에는 기본값이 없다.
 * 5. 자동차 운전자 분기는 채널 술어보다 앞이다(운전자 모드 기기 음성은 토글과 무관 — spec §2).
 */

const ROOT = join(__dirname, "../../..");
const APP = join(ROOT, "ios/Gildongmu");
const DIR = join(APP, "Directions");
const SKIP = new Set(["build", ".build", "DerivedData", "node_modules", ".git"]);
const MODELS = ["BeaconModel.swift", "TransitGuideModel.swift", "OutingModel.swift"];

function swiftFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...swiftFiles(full));
    else if (name.endsWith(".swift")) out.push(full);
  }
  return out;
}

/** 이름으로 찾은 Swift 함수 본문(여는 중괄호부터 짝이 맞는 닫는 중괄호까지). */
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

const read = (path: string) => readFileSync(path, "utf8");

/** `marker` 뒤 첫 `{`부터 짝이 맞는 `}`까지 — 문자 수 창과 달리 클로저 밖으로 옮긴 호출을 통과시키지 않는다(코드 품질 리뷰 m3). */
function closureAfter(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`${marker}를 찾지 못했다`);
  const open = source.indexOf("{", at + marker.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`${marker}의 클로저 끝을 찾지 못했다`);
}

describe("백그라운드 음성 안내 배선 (E53)", () => {
  it("안내 기기 음성 호출은 공유 출력 1곳 + 운전자 채널 1곳뿐이다", () => {
    const calls: string[] = [];
    for (const file of swiftFiles(APP)) {
      const hits = read(file).match(/\.speakGuidance\(/g) ?? [];
      for (let i = 0; i < hits.length; i++) calls.push(relative(ROOT, file));
    }
    expect(calls.sort()).toEqual([
      "ios/Gildongmu/Directions/BeaconModel.swift",
      "ios/Gildongmu/Directions/GuideSpeechOutput.swift",
    ]);
    // 운전자 채널 자리는 post의 driverChannel 분기 안이고, 그 분기는 채널 술어보다 앞이다.
    const post = functionBody(read(join(DIR, "BeaconModel.swift")), "post");
    const driver = post.indexOf("if driverChannel {");
    const speak = post.indexOf("TtsPlayer.shared.speakGuidance(");
    const channel = post.indexOf("GuideSpeechOutput.channel(");
    expect(driver).toBeGreaterThanOrEqual(0);
    expect(speak).toBeGreaterThan(driver);
    expect(channel).toBeGreaterThan(speak);
  });

  it("봉인 플래그 experimentalBackgroundSpeechEnabled는 2.0에서 졸업해 남아 있지 않다", () => {
    const offenders = swiftFiles(join(ROOT, "ios")).filter((f) => read(f).includes("experimentalBackgroundSpeechEnabled"));
    expect(offenders).toEqual([]);
  });

  it("토글 실효값은 한 함수이고 저장값만 넘긴다", () => {
    const users = swiftFiles(APP).filter((f) => read(f).includes("BackgroundSpeech.isEnabled("));
    expect(users.map((f) => relative(ROOT, f))).toEqual(["ios/Gildongmu/Directions/GuideSpeechOutput.swift"]);
    const output = read(join(DIR, "GuideSpeechOutput.swift"));
    expect(output).toMatch(/BackgroundSpeech\.isEnabled\(\s*stored: UserDefaults\.standard\.object\(forKey: BackgroundSpeech\.storageKey\) as\? Bool\)/);
    // 채널 술어에는 그 실효값이 들어간다(저장값을 직접 읽는 우회 금지).
    expect(output).toContain("backgroundSpeechEnabled: backgroundSpeechEnabled,");
    // 원복 유예도 같은 실효값으로 가른다(토글 끔은 0초).
    expect(functionBody(output, "sessionEndHoldSeconds")).toContain("backgroundSpeechEnabled");
  });

  it("설정 행은 한 자리이고 실험 조건(#if) 밖에 있다", () => {
    const settings = read(join(APP, "SettingsView.swift"));
    const row = settings.indexOf('appLocalized("ios.settings.backgroundSpeech")');
    expect(row).toBeGreaterThanOrEqual(0);
    expect(settings.split('"ios.settings.backgroundSpeech"').length - 1).toBe(1);
    // 행 앞의 마지막 `#if`가 닫혀 있어야 한다(실험 구성 안으로 들어가지 않았다).
    const before = settings.slice(0, row);
    expect(before.lastIndexOf("#endif")).toBeGreaterThan(before.lastIndexOf("#if "));
  });

  it.each(MODELS)("%s의 post는 채널 술어를 지나고 VoiceOver 게시는 공유 출력으로만 한다", (name) => {
    const source = read(join(DIR, name));
    const post = functionBody(source, "post");
    // 가청 여부는 그 모델 재생기의 값(설계 리뷰 B1 — 들리지 않는 문장을 "전달"로 치지 않는다).
    expect(post).toMatch(
      /GuideSpeechOutput\.channel\(\s*speechClass, foregroundDeviceSpeech: (true|false), backgroundAudible: tones\.isBackgroundAudible\)/,
    );
    expect(post).toContain("case .drop:");
    expect(post).toContain("deviceSpeech.submit(");
    // 모델이 직접 VoiceOver 통지를 조립하지 않는다(채널을 우회하는 게시 경로 금지).
    expect(source).not.toContain("AccessibilityNotification.Announcement(");
    // 나들이만 전경 ∧ VoiceOver 꺼짐에서도 기기 음성이다.
    expect(post.includes("foregroundDeviceSpeech: true")).toBe(name === "OutingModel.swift");
  });

  it.each(MODELS)("%s의 분류 인자(speechClass)에는 기본값이 없다", (name) => {
    const source = read(join(DIR, name));
    expect(source).not.toMatch(/speechClass: GuideSpeechClass\s*=/);
  });

  it("복귀 인계 목록은 상환과 한 통지로 합쳐진다 — 도보는 상환보다 먼저, 대중교통은 추적 가드 앞(spec §4.2 ⑥)", () => {
    const beacon = functionBody(read(join(DIR, "BeaconModel.swift")), "handleScenePhaseChange");
    expect(beacon).toContain("let handed = returnedFromBackground ? deviceSpeech.handOver() : .empty");
    expect(beacon.indexOf("deviceSpeech.handOver()")).toBeLessThan(beacon.indexOf("let owed ="));
    // 인계 목록이 상환 문장에 들어가고, 상환은 인계 유무와 무관하게 .high(구현 리뷰 M-2·M-3, E57 후속 설계 리뷰 MAJOR 1 —
    // 앱 활성화 순간 기본 우선순위는 잠식되고, 잠식되면 시트의 복귀 착지가 상한까지 기다린다).
    expect(beacon).toContain("let owed = (handed.texts + [pendingStepFreeNotice, intro, tail]");
    expect(beacon).toContain("announce(owed, highPriority: true, speechClass: .actionable)");
    // 꼬리(현재 상태)는 버린 문장이 있을 때만, 인계와 같은 문장이면 뺀다 — 낭독 정정 뒤끼리 비교(검증 리뷰 N2·N8).
    expect(beacon).toContain("let tail = !repaying ||");
    expect(beacon).toContain("handed.texts.contains(spokenUnits(current))");
    // 합본이 억제로 버려지면 인계받은 문장의 장부도 되돌린다(횡단 리뷰 F6).
    expect(closureAfter(beacon, "announce(owed, highPriority: true, speechClass: .actionable) {")).toContain("handed.undelivered()");
    const transit = functionBody(read(join(DIR, "TransitGuideModel.swift")), "handleScenePhaseChange");
    // 대중교통은 되돌리지 않는다(`.texts`만): 억제 버림은 `droppedWhileSuppressed`가 해제 때 합본째 다시 낸다(F6 기각).
    expect(transit.indexOf("handed = deviceSpeech.handOver().texts")).toBeGreaterThanOrEqual(0);
    expect(transit.indexOf("handed = deviceSpeech.handOver().texts")).toBeLessThan(transit.indexOf("guard isTracking else { return }"));
    expect(transit).toContain("let owed = handed + ");
    // 합친 뒤 비워야 defer가 같은 인계 문장을 한 번 더 게시하지 않는다(검증 리뷰 N8).
    const merged = transit.slice(transit.indexOf("let owed = handed + "));
    expect(merged.slice(0, merged.indexOf("announce("))).toContain("handed = []");
    // 유휴 재개 복귀는 재개 문장 앞에 싣는다(검증 리뷰 N4).
    expect(transit).toMatch(/if resumedFromIdle \{\s*resumePrefix = handed\s*handed = \[\]/);
    // 합칠 자리를 지나지 않은 경로는 defer가 따로 낸다(비추적 복귀 — 백그라운드에서 끝난 세션의 완료 문장).
    expect(transit).toMatch(/defer \{\s*if !handed\.isEmpty \{\s*announce\(handed\.joined/);
    const outing = functionBody(read(join(DIR, "OutingModel.swift")), "handleScenePhaseChange");
    expect(outing).toContain("let handed = deviceSpeech.handOver()");
    expect(outing).toContain("var owed = handed.texts");
    expect(outing).toMatch(/say\(owed\.joined\(separator: " "\), highPriority: true, speechClass: \.actionable\) \{ \[weak self\] in\s*if let repaidEnd \{ self\?\.owedEndReason = repaidEnd \}\s*handed\.undelivered\(\)/);
  });

  it("prewalk 권한·정밀 위치 상실 종료는 도보 실패 문장에 대중교통 미시작을 붙이고, 코디네이터는 따로 내지 않는다(횡단 리뷰 F3)", () => {
    const beacon = read(join(DIR, "BeaconModel.swift"));
    const fail = functionBody(beacon, "stopAndFail");
    // stop()이 prewalkTarget을 지우므로 그 앞에서 캡처한다.
    expect(fail.indexOf("let prewalk = prewalkTarget != nil")).toBeLessThan(fail.indexOf("stopLeavingSummary("));
    expect(fail).toContain('trailingKey: prewalk ? "ios.beacon.prewalkCancelledTail" : nil');
    // 버려지면 복귀 상환이 `statusText` 꼬리로 갚으므로 `statusText`도 결합 문장이어야 한다(spec 준수 리뷰 m3).
    expect(functionBody(beacon, "fail")).toContain("statusText = joinText(appLocalized(key), trailingKey.map { appLocalized($0) })");
    // 종료 화면이 남지 않으면(시트가 닫혀 커서가 옮겨 간다) 실패 통지는 `.high`(접근성 감사 L4).
    expect(fail).toContain("let leftEndScreen = stopLeavingSummary(");
    expect(fail).toContain("highPriority: !leftEndScreen");
    const coordinator = read(join(DIR, "GuideSessionCoordinator.swift"));
    const ended = coordinator.slice(coordinator.indexOf("        case .ended:"), coordinator.indexOf("    /// 낡은 연결 폐기"));
    expect(ended).not.toContain("announceExternal");
  });

  it("칸 밖의 정지(받아쓰기·채팅)가 안내 발화를 끊으면 대기 칸에 알린다 — 칸 자신의 정지는 알리지 않는다(횡단 리뷰 F4)", () => {
    const tts = read(join(ROOT, "ios/Gildongmu/Chat/TtsPlayer.swift"));
    // 끊을 때 알릴 토큰은 "합성기에 남았는가"(일시정지 포함, 코드 품질 리뷰 M1). 다른 칸의 발화를 끊는 `speakGuidance`도 알리고
    // (m1), 인계의 `stopGuidance`만 알리지 않는다.
    expect(functionBody(tts, "stop")).toMatch(/let interrupted = guidanceInSynth \? generation : nil\s*halt\(\)\s*notifyInterrupted\(interrupted, \.undelivered\)/);
    // 더 새 안내가 이었다 — `superseded`(끝난 세션 문장에 복귀 상환 표식을 세우지 않는다, 증분 리뷰 m1).
    expect(functionBody(tts, "speakGuidance")).toMatch(/let interrupted = guidanceInSynth \? generation : nil\s*halt\(\)[\s\S]{0,300}notifyInterrupted\(interrupted, \.superseded\)/);
    expect(functionBody(tts, "stopGuidance")).toContain("halt()");
    expect(functionBody(tts, "stopGuidance")).not.toContain("notifyInterrupted");
    expect(tts).toContain("func isSpeakingGuidance(token: Int) -> Bool { guidanceInSynth && generation == token }");
    // 오디오 인터럽션이 시작되면 안내 발화를 끊고 알린다(접근성 감사 M2 — 일시정지로 남은 문장은 들리지 않았다).
    expect(tts).toMatch(/AVAudioSession\.interruptionNotification[\s\S]{0,400}== \.began[\s\S]{0,900}if !suspended, player\.guidanceInSynth \{ player\.stop\(\) \}/);
    // 일시정지로 남은 발화는 말하는 중이 아니다 — 세면 대기 칸이 선점 문장까지 막힌다(횡단 리뷰 F5, 시간 상한은 정상 긴 문장을
    // 끊어 설계 리뷰 MAJOR 3로 폐기).
    expect(tts).toContain("var isSpeakingGuidance: Bool { guidanceInSynth && !synthesizer.isPaused }");
    expect(tts).toContain("private var guidanceInSynth: Bool { synthesizer.isSpeaking && playingMessageID == nil }");
    const output = read(join(DIR, "GuideSpeechOutput.swift"));
    expect(output).toMatch(/TtsPlayer\.shared\.observeGuidanceInterruption \{ \[weak queue\] token, reason in\s*queue\?\.speechInterrupted\(token: token, reason: reason\)/);
  });

  it("도보 post: 버림은 복귀 표식을 세우고, 기기 음성은 내리고, 대기 칸의 미전달만 다시 세운다(spec §4.3)", () => {
    const post = functionBody(read(join(DIR, "BeaconModel.swift")), "post");
    const device = post.slice(post.indexOf("case .device:"), post.indexOf("case .drop:"));
    expect(device).toContain("missedAnnouncement = false");
    expect(device).toContain("if reason == .undelivered { self?.missedAnnouncement = true }");
    expect(post.slice(post.indexOf("case .drop:"))).toContain("missedAnnouncement = true");
  });

  it("세 모델의 세션 종료 원복은 기기 음성이 끝날 때까지 기다린다(설계 리뷰 M4)", () => {
    for (const name of MODELS) {
      const source = read(join(DIR, name));
      expect(source, name).toMatch(
        /tones\.endSession\([\s\S]{0,200}?speechBusy: \{ \[weak self\] in GuideSpeechOutput\.speechBusy\(self\?\.deviceSpeech\) \}\)/,
      );
    }
  });

  it("세션 경계(advanceGeneration)마다 바로 뒤에서 대기 칸을 버림 통지 없이 비운다(spec §4.2 ⑤)", () => {
    for (const name of MODELS) {
      const lines = read(join(DIR, name)).split("\n");
      const boundaries = lines
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => !line.trimStart().startsWith("//") && line.includes(".advanceGeneration()"));
      expect(boundaries.length, name).toBeGreaterThan(0);
      for (const { i } of boundaries) {
        // 짝은 같은 블록 3줄 안이다 — 개수 비교만으로는 reset을 엉뚱한 자리로 옮겨도 통과한다(구현 리뷰 m-4).
        const window = lines.slice(i, i + 4).join("\n");
        expect(window, `${name}:${i + 1}`).toContain("deviceSpeech.reset()");
      }
    }
  });
});
