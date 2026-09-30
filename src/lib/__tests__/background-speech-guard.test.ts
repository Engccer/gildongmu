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

  it("복귀 처리는 기기 음성을 VoiceOver로 인계하고, 도보·대중교통은 그것이 상환보다 먼저다(spec §4.2 ⑤)", () => {
    const beacon = functionBody(read(join(DIR, "BeaconModel.swift")), "handleScenePhaseChange");
    expect(beacon).toContain("if returnedFromBackground { deviceSpeech.handOver() }");
    expect(beacon.indexOf("deviceSpeech.handOver()")).toBeLessThan(beacon.indexOf("let owed ="));
    const transit = functionBody(read(join(DIR, "TransitGuideModel.swift")), "handleScenePhaseChange");
    // 추적 가드 앞 — 세션이 백그라운드에서 끝나도 말하는 중인 완료 문장을 넘긴다.
    expect(transit.indexOf("deviceSpeech.handOver()")).toBeGreaterThanOrEqual(0);
    expect(transit.indexOf("deviceSpeech.handOver()")).toBeLessThan(transit.indexOf("guard isTracking else { return }"));
    expect(functionBody(read(join(DIR, "OutingModel.swift")), "handleScenePhaseChange")).toContain(
      "deviceSpeech.handOver()",
    );
  });

  it("세 모델의 세션 종료 원복은 기기 음성이 끝날 때까지 기다린다(설계 리뷰 M4)", () => {
    for (const name of MODELS) {
      const source = read(join(DIR, name));
      expect(source, name).toMatch(
        /tones\.endSession\([\s\S]{0,200}?speechBusy: \{ \[weak self\] in GuideSpeechOutput\.speechBusy\(self\?\.deviceSpeech\) \}\)/,
      );
    }
  });

  it("세션 경계마다 기기 음성 대기 칸을 버림 통지 없이 비운다(spec §4.2 ⑤)", () => {
    for (const name of MODELS) {
      const source = read(join(DIR, name));
      // 주석 줄은 세지 않는다(문서 속 언급이 짝 계수를 부풀리지 않게).
      const code = source.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
      const generations = (code.match(/\.advanceGeneration\(\)/g) ?? []).length;
      const resets = (code.match(/deviceSpeech\.reset\(\)/g) ?? []).length;
      expect(generations, name).toBeGreaterThan(0);
      expect(resets, name).toBeGreaterThanOrEqual(generations);
    }
  });
});
