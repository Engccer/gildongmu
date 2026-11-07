import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 영역별 함정은 .claude/rules/*.md에 있고 머리 `paths`에 맞는 파일을 열 때만 실린다.
// CLAUDE.md §영역별 규칙 색인은 설계 단계·다른 에이전트가 그 파일을 찾는 유일한 길이므로
// 색인과 실제 파일이 갈리면 규칙 하나가 조용히 사라진다. 파일별 상한은 재팽창 가드다.
const RULE_BUDGET_BYTES = 32_000;
const root = new URL("../../../", import.meta.url);
const rulesDir = fileURLToPath(new URL(".claude/rules/", root));
const claudeMd = readFileSync(fileURLToPath(new URL("CLAUDE.md", root)), "utf8");
const files = readdirSync(rulesDir).filter((f) => f.endsWith(".md")).sort();

describe(".claude/rules 색인", () => {
  it("규칙 파일이 있다", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("CLAUDE.md 색인과 실제 파일 목록이 같다", () => {
    const indexed = [...claudeMd.matchAll(/`\.claude\/rules\/([\w-]+\.md)`/g)].map((m) => m[1]);
    expect([...new Set(indexed)].sort()).toEqual(files);
  });

  it.each(files)("%s는 paths 머리를 갖고 상한 안이다", (f) => {
    const path = `${rulesDir}${f}`;
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/^---\npaths:\n(  - "[^"]+"\n)+---\n/);
    expect(statSync(path).size).toBeLessThanOrEqual(RULE_BUDGET_BYTES);
  });
});
