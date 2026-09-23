import { describe, it, expect } from "vitest";
import fixture from "./fixtures/markdown-plain-text-cases.json";
import { markdownToPlainText } from "../markdown-plain-text";

// Kit MarkdownPlainTextTests와 같은 fixture — 두 결과가 갈리면 이 테스트가 먼저 빨개진다.
describe("markdownToPlainText (Kit MarkdownPlainText.strip 미러)", () => {
  it("fixture가 비지 않았다", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(28);
  });

  it.each(fixture.cases)("$name", ({ input, expect: expected }) => {
    expect(markdownToPlainText(input)).toBe(expected);
  });
});
