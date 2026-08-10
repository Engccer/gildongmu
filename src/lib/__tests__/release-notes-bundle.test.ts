import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseReleaseNotes } from "../../../scripts/build-release-notes.mjs";

const REPO_ROOT = join(__dirname, "..", "..", "..");

const md = (body: string) => `# 머리말\n\n작성 규칙 프로즈.\n\n---\n\n${body}`;

describe("parseReleaseNotes", () => {
  it("버전별 ko·en 코드블록을 추출한다(등장 순서 보존)", () => {
    const notes = parseReleaseNotes(md(
      "## 1.4 (빌드 10)\n\n제출 메모.\n\n### ko\n\n```\n새로운 기능\n- 가\n```\n\n### en\n\n```\nNew\n- a\n```\n\n## 1.3 (빌드 9)\n\n### ko\n\n```\n개선\n```\n\n### en\n\n```\nImproved\n```\n",
    ));
    expect(notes).toEqual([
      { version: "1.4", ko: "새로운 기능\n- 가", en: "New\n- a" },
      { version: "1.3", ko: "개선", en: "Improved" },
    ]);
  });

  it("ko·en 둘 다 없는 버전은 제외한다(1.0형 — What's New 없는 첫 출시)", () => {
    const notes = parseReleaseNotes(md(
      "## 1.1 (빌드 7)\n\n### ko\n\n```\n가\n```\n\n### en\n\n```\na\n```\n\n## 1.0 (빌드 6)\n\n첫 출시라 What's New가 없다.\n",
    ));
    expect(notes.map((n) => n.version)).toEqual(["1.1"]);
  });

  it("한쪽 언어만 있으면 throw한다(불완전 데이터로 조용히 출시 금지)", () => {
    expect(() => parseReleaseNotes(md(
      "## 1.2 (빌드 8)\n\n### ko\n\n```\n가\n```\n",
    ))).toThrow(/1\.2/);
  });
});

describe("번들 드리프트 가드", () => {
  it("release-notes.json이 md 정본과 일치한다", () => {
    const source = readFileSync(join(REPO_ROOT, "docs", "appstore", "release-notes.md"), "utf8");
    const bundled = JSON.parse(readFileSync(
      join(REPO_ROOT, "ios", "Gildongmu", "Resources", "release-notes.json"), "utf8"));
    expect(
      bundled,
      "release-notes.md가 바뀌었다 — `node scripts/build-release-notes.mjs`로 번들을 재생성할 것",
    ).toEqual(parseReleaseNotes(source));
  });
});
