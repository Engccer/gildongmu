import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 백그라운드 음성 안내(E53, spec `docs/superpowers/specs/2026-09-30-background-speech-design.md`) 소스 가드.
 * 판정(채널 술어·분류·대기 칸)은 Kit 테스트가 잠그고, 여기는 컴파일러가 못 잡는 배선과 **정식판 불변**을 잠근다:
 *
 * 1. 안내의 기기 음성(`speakGuidance`)은 공유 출력 한 곳과 자동차 운전자 채널 한 곳에서만 부른다 — 다른 자리가
 *    부르면 토글·분류를 우회해 정식판에서도 백그라운드 음성이 나간다.
 * 2. 토글 실효값은 한 함수(`GuideSpeechOutput.backgroundSpeechEnabled`)이고 봉인 플래그를 `available`로 넘긴다.
 *    플래그는 `#if EXPERIMENTAL`에서만 참이다 — 정식판은 실효값이 상수 거짓이라 채널 술어가 종전 분기와 같다(Kit
 *    `GuideSpeechChannelTests.releaseEquivalenceForBeaconAndTransit`).
 * 3. 설정 행은 봉인 플래그 조건 안에만 있다.
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

  it("봉인 플래그는 #if EXPERIMENTAL에서만 참이다", () => {
    const config = read(join(APP, "AppConfig.swift"));
    expect(config).toMatch(
      /#if EXPERIMENTAL\n\s+static let experimentalBackgroundSpeechEnabled = true\n\s+#else\n\s+static let experimentalBackgroundSpeechEnabled = false\n\s+#endif/,
    );
  });

  it("토글 실효값은 한 함수이고 봉인 플래그를 available로 넘긴다", () => {
    const users = swiftFiles(APP).filter((f) => read(f).includes("BackgroundSpeech.isEnabled("));
    expect(users.map((f) => relative(ROOT, f))).toEqual(["ios/Gildongmu/Directions/GuideSpeechOutput.swift"]);
    const output = read(join(DIR, "GuideSpeechOutput.swift"));
    expect(output).toMatch(/BackgroundSpeech\.isEnabled\([\s\S]*?available: AppConfig\.experimentalBackgroundSpeechEnabled\)/);
    // 채널 술어에는 그 실효값이 들어간다(저장값을 직접 읽는 우회 금지).
    expect(output).toContain("backgroundSpeechEnabled: backgroundSpeechEnabled,");
    // 원복 유예도 같은 실효값으로 가른다(정식판 0초).
    expect(functionBody(output, "sessionEndHoldSeconds")).toContain("backgroundSpeechEnabled");
  });

  it("설정 행은 봉인 플래그 조건 안에만 있다", () => {
    const settings = read(join(APP, "SettingsView.swift"));
    const row = settings.indexOf('appLocalized("ios.settings.backgroundSpeech")');
    expect(row).toBeGreaterThanOrEqual(0);
    expect(settings.split('"ios.settings.backgroundSpeech"').length - 1).toBe(1);
    const gate = settings.lastIndexOf("if AppConfig.experimentalBackgroundSpeechEnabled {", row);
    expect(gate).toBeGreaterThanOrEqual(0);
    // 조건과 행 사이에 블록이 닫히지 않는다(조건 밖으로 새지 않았다).
    const between = settings.slice(gate, row);
    const opens = (between.match(/\{/g) ?? []).length;
    const closes = (between.match(/\}/g) ?? []).length;
    expect(opens).toBeGreaterThan(closes);
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
    expect(beacon).toContain("let handed = returnedFromBackground ? deviceSpeech.handOver() : []");
    expect(beacon.indexOf("deviceSpeech.handOver()")).toBeLessThan(beacon.indexOf("let owed ="));
    // 인계 목록이 상환 문장에 들어가고, 인계가 섞이면 .high(구현 리뷰 M-2·M-3).
    expect(beacon).toContain("let owed = (handed + [pendingStepFreeNotice, intro, tail]");
    expect(beacon).toContain("announce(owed, highPriority: !handed.isEmpty, speechClass: .actionable)");
    // 꼬리(현재 상태)는 버린 문장이 있을 때만, 인계와 같은 문장이면 뺀다 — 낭독 정정 뒤끼리 비교(검증 리뷰 N2·N8).
    expect(beacon).toContain("let tail = !repaying ||");
    expect(beacon).toContain("handed.contains(spokenUnits(current))");
    const transit = functionBody(read(join(DIR, "TransitGuideModel.swift")), "handleScenePhaseChange");
    expect(transit.indexOf("handed = deviceSpeech.handOver()")).toBeGreaterThanOrEqual(0);
    expect(transit.indexOf("handed = deviceSpeech.handOver()")).toBeLessThan(transit.indexOf("guard isTracking else { return }"));
    expect(transit).toContain("let owed = handed + ");
    // 합친 뒤 비워야 defer가 같은 인계 문장을 한 번 더 게시하지 않는다(검증 리뷰 N8).
    const merged = transit.slice(transit.indexOf("let owed = handed + "));
    expect(merged.slice(0, merged.indexOf("announce("))).toContain("handed = []");
    // 유휴 재개 복귀는 재개 문장 앞에 싣는다(검증 리뷰 N4).
    expect(transit).toMatch(/if resumedFromIdle \{\s*resumePrefix = handed\s*handed = \[\]/);
    // 합칠 자리를 지나지 않은 경로는 defer가 따로 낸다(비추적 복귀 — 백그라운드에서 끝난 세션의 완료 문장).
    expect(transit).toMatch(/defer \{\s*if !handed\.isEmpty \{\s*announce\(handed\.joined/);
    const outing = functionBody(read(join(DIR, "OutingModel.swift")), "handleScenePhaseChange");
    expect(outing).toContain("var owed = deviceSpeech.handOver()");
    expect(outing).toContain('say(owed.joined(separator: " "), highPriority: true, speechClass: .actionable)');
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
