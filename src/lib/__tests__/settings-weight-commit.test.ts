import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 설정 체중 입력 계약의 소스 가드(A39, spec `docs/superpowers/specs/2026-09-11-settings-weight-commit-design.md`).
 *
 * 뷰 계층엔 테스트 레인이 없고(iOS SwiftUI), 이 결함은 **아무 오류도 내지 않고 조용히** 값을 버렸다 —
 * 스크린 리더 사용자에겐 "저장됨"과 구분할 단서가 0이었다. 판정 자체는 Kit 순수 함수
 * (`WalkHealth.weightCommit`, `WalkHealthTests`)가 잠그고, 여기서는 **뷰가 그 판정을 어떻게 쓰는가**를
 * 잠근다. Swift 소스를 웹 테스트가 읽는 선례: `transit-landing-guard.test.ts`.
 */
const ROOT = join(__dirname, "../../..");
const SETTINGS = readFileSync(join(ROOT, "ios/Gildongmu/SettingsView.swift"), "utf8");

describe("SettingsView 체중 입력 (A39)", () => {
  it("판정 시점은 편집 종료다 — 타자 한 글자마다 커밋하지 않는다", () => {
    // 종전 회귀 자리: `onChange(of: weightText)`가 중간값(5 → 50 → 500)마다 판정했다.
    expect(SETTINGS).not.toMatch(/onChange\(of: weightText\)/);
    // `.decimalPad`엔 Return이 없어 onSubmit이 오지 않는다 — 이탈·닫힘 두 경로가 종료 신호다.
    expect(SETTINGS).toContain(".focused($weightFieldEditing)");
    expect(SETTINGS).toContain(
      ".onChange(of: weightFieldEditing) { _, editing in if !editing { commitWeight() } }",
    );
    expect(SETTINGS).toContain(".onDisappear { commitWeight() }");
    // [닫기]는 dismiss 앞에서 커밋한다(통지가 화면 전환에 묻히지 않게).
    expect(SETTINGS).toMatch(/commitWeight\(\)\n\s+dismiss\(\)/);
  });

  it("거절은 저장하지 않고 직전 값을 유지하며 .high로 통지한다(3-state)", () => {
    const start = SETTINGS.indexOf("private func commitWeight()");
    const body = SETTINGS.slice(start, SETTINGS.indexOf("\n    }\n", start));
    expect(body).toContain("case .reject:");
    // 종전 회귀 자리: 범위 밖을 0으로 덮었다. reject 갈래는 weightKg에 쓰지 않는다.
    const reject = body.slice(body.indexOf("case .reject:"));
    expect(reject).not.toMatch(/weightKg\s*=/);
    expect(reject).toContain("weightText = weightKg > 0 ? Self.formatWeight(weightKg) : \"\"");
    expect(reject).toContain("accessibilitySpeechAnnouncementPriority = .high");
    // 직전 값 유무로 문장이 갈린다(사용자가 다음에 할 일이 다르다).
    expect(reject).toContain("ios.settings.weightRejected");
    expect(reject).toContain("ios.settings.weightRejectedNone");
    // 판정은 Kit 순수 함수를 지난다(뷰에서 범위를 다시 세지 않는다).
    expect(body).toContain("WalkHealth.weightCommit(text: weightText)");
  });

  it("허용 범위는 Kit 상수에서 온다 — 문장에 숫자를 박지 않는다", () => {
    expect(SETTINGS).toContain("Int(WalkHealth.weightRange.lowerBound)");
    expect(SETTINGS).toContain("Int(WalkHealth.weightRange.upperBound)");
    // 푸터는 그 값을 인자로 받는 단일 Text(상시 표시 + E31 §5 잔여 문장 흡수).
    expect(SETTINGS).toContain(
      'Text(appLocalized("ios.settings.weightFooter", Self.weightMin, Self.weightMax))',
    );
  });
});
