import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A61: 탭 트리를 재생성하는 갱신(언어 전환·탭 순서)은 "길찾기" 프리필 소거와 한 갱신에 묶는다.
// 원시 저장 값을 `.id`에 직접 넣으면 재생성이 먼저 일어나 새 길찾기 탭이 남은 프리필로 경로를 다시 조회한다.
// 뷰 계층은 테스트 레인이 없어 배선을 소스 가드로 잠근다.
const app = readFileSync(join(process.cwd(), "ios/Gildongmu/GildongmuApp.swift"), "utf8");

describe("A61 언어 전환·탭 순서 재생성과 프리필 소거", () => {
  it("탭 트리 .id는 원시 저장 값이 아니라 onChange가 올리는 세대만 담는다", () => {
    expect(app).toContain('.id("\\(sessionEpoch)#\\(languageEpoch)#\\(tabOrderEpoch)")');
    expect(app).not.toMatch(/\.id\([^)]*languageRaw/);
    expect(app).not.toMatch(/\.id\([^)]*tabOrderRaw/);
  });

  it("세대를 올리는 onChange는 같은 블록에서 프리필을 비운다", () => {
    for (const [raw, epoch] of [["languageRaw", "languageEpoch"], ["tabOrderRaw", "tabOrderEpoch"]]) {
      const block = app.match(new RegExp(`\\.onChange\\(of: ${raw}\\) \\{[\\s\\S]*?\\n {12}\\}`))?.[0] ?? "";
      expect(block, raw).toContain("directionsPrefill = nil");
      expect(block, raw).toContain(`${epoch} += 1`);
    }
  });
});
