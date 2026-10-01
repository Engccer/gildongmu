import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * E59(위원장 판정 2026-10-02): 설정 화면의 헤딩은 주제 묶음 다섯에만 있고, 설정 하나는 언제나 한 줄이다
 * (고르기 = "이름, 현재 값" 메뉴 피커, 켜고 끄기 = 토글). 종전엔 인라인 피커만 섹션 머리말 = 헤딩을 얻어,
 * 헤딩으로 건너뛰면 언어·백그라운드 음성 안내·체중을 지나쳤다. 앱 타깃은 테스트 레인이 없어 배치를 소스로 잠근다.
 * 안드로이드 미러는 `SettingsRowsTest`(묶음·순서)와 `SettingsScreenA11yTest`(헤딩 시맨틱)가 잠근다.
 */
const ROOT = join(__dirname, "../../..");
const SETTINGS = readFileSync(join(ROOT, "ios/Gildongmu/SettingsView.swift"), "utf8");
const BODY = SETTINGS.slice(SETTINGS.indexOf("var body: some View"));

/** 판정의 묶음과 그 안 항목 순서(실험판 항목은 `#if` 안이라도 소스 순서로 잠근다). */
const GROUPS: [heading: string, items: string[]][] = [
  ["ios.settings.sectionGeneral", ["ios.settings.theme", "ios.settings.language"]],
  ["ios.settings.sectionVoice", ["ios.settings.dictationStyle", "ios.settings.listenSpeed"]],
  [
    "ios.settings.sectionGuidance",
    [
      "ios.settings.backgroundSpeech",
      "ios.settings.weightKg",
      "ios.settings.carListener",
      "ios.settings.leftRightTone",
      "ios.settings.trendHaptics",
    ],
  ],
  ["ios.settings.aiSection", ["ios.settings.aiConsentToggle", "ios.common.privacyPolicy", "ios.settings.reportProblem"]],
  ["ios.settings.sectionAbout", ["dataSources.title", "ios.settings.releaseNotes"]],
];

/** 키가 본문에 `appLocalized("<key>"` 꼴로 정확히 한 번 나오는 자리. */
function at(key: string): number {
  const needle = `appLocalized("${key}"`;
  expect(BODY.split(needle).length - 1, key).toBe(1);
  return BODY.indexOf(needle);
}

describe("설정 화면은 주제 묶음 다섯이고 설정 하나는 한 줄이다(E59)", () => {
  it("헤딩 다섯이 판정 순서이고 각 항목은 자기 묶음 헤딩과 다음 헤딩 사이에 판정 순서로 있다", () => {
    // 헤딩의 자리 = 그 머리말을 가진 `Section`의 시작(`header:` 블록은 내용 뒤에 쓰인다).
    const headings = GROUPS.map(([h]) => BODY.lastIndexOf("Section", at(h)));
    expect([...headings].sort((a, b) => a - b)).toEqual(headings);
    GROUPS.forEach(([, items], g) => {
      const positions = items.map(at);
      expect([...positions].sort((a, b) => a - b), GROUPS[g][0]).toEqual(positions);
      expect(positions[0]).toBeGreaterThan(headings[g]);
      if (g + 1 < headings.length) expect(positions[positions.length - 1]).toBeLessThan(headings[g + 1]);
    });
  });

  it("헤딩을 만드는 머리말은 그 다섯뿐이다(설명 문장이 붙는 설정은 헤더 없는 섹션으로 잇는다)", () => {
    const titled = BODY.match(/Section\(appLocalized\(/g)?.length ?? 0;
    const headerBlocks = BODY.match(/\} header: \{/g)?.length ?? 0;
    expect(titled + headerBlocks).toBe(GROUPS.length);
    // 인라인 피커는 자기 라벨을 머리말처럼 그려 헤딩을 하나 더 만든다 — 설정 하나 = 한 줄이 깨진다.
    expect(SETTINGS).not.toContain(".pickerStyle(.inline)");
  });

  it("설명 문장은 그 설정 바로 뒤의 footer다", () => {
    for (const [setting, footer] of [
      ["ios.settings.backgroundSpeech", "ios.settings.backgroundSpeechFooter"],
      ["ios.settings.weightKg", "ios.settings.weightFooter"],
      ["ios.settings.trendHaptics", "ios.settings.trendHapticsFooter"],
    ]) {
      const between = BODY.slice(at(setting), at(footer));
      expect(between, footer).toContain("} footer: {");
      // 사이에 다른 설정 행이 끼지 않는다.
      expect(between, footer).not.toMatch(/(Picker|Toggle|TextField|Link|NavigationLink)\(/);
    }
  });
});
