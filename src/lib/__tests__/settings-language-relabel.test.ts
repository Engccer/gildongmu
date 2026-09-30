import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A51(2026-09-27 관찰): 설정에서 언어를 바꾸면 제목·"언어" 줄은 새 언어가 되는데 **인라인 피커의 선택지 행**은
 * 옛 언어로 남았다. 본문은 다시 계산되지만 인라인 피커가 선택지 행을 태그 정체성으로 붙들어 두기 때문이다.
 * 그래서 인라인 피커는 실효 언어를 정체성으로 받아 언어가 바뀌면 새로 만들어진다. 앱 타깃은 테스트 레인이
 * 없어 배선을 소스로 잠근다 — 새 인라인 피커를 더하며 이 줄을 빠뜨리면 그 피커만 옛 언어로 남는다.
 */
const ROOT = join(__dirname, "../../..");
const SETTINGS = readFileSync(join(ROOT, "ios/Gildongmu/SettingsView.swift"), "utf8");

describe("설정의 인라인 피커는 언어가 바뀌면 새로 그려진다(A51)", () => {
  it("모든 `.pickerStyle(.inline)` 바로 다음 줄이 이름 붙은 언어 정체성이고 이름이 겹치지 않는다", () => {
    const lines = SETTINGS.split("\n");
    const inline = lines.flatMap((l, i) => (l.trim() === ".pickerStyle(.inline)" ? [i] : []));
    expect(inline.length).toBeGreaterThan(0);
    const names = inline.map((i) => {
      const m = /^\.id\("([A-Za-z]+)-\\\(AppLanguage\.current\)"\)$/.exec(lines[i + 1]?.trim() ?? "");
      expect(m, `SettingsView.swift:${i + 2}`).not.toBeNull();
      return m![1];
    });
    // 형제 행에 같은 식별자를 주면 SwiftUI가 행 정체성을 섞을 수 있다 — 피커마다 다른 이름.
    expect(new Set(names).size).toBe(names.length);
    // 인라인 피커는 이 표기 하나로만 쓴다(다른 표기면 위 스캔이 놓친다).
    expect(SETTINGS).not.toMatch(/InlinePickerStyle\(\)/);
  });
});
