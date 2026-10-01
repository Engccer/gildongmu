import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 2.0 공지(spec `docs/superpowers/specs/2026-10-01-release-2.0-graduation-design.md` §1·§2) 소스 가드.
 * 계약은 "확인을 누르면 다시 뜨지 않는다"이고(저장은 확인 클로저 안에서만), 탈출 제스처는 막지 않는다
 * (`interactiveDismissDisabled` 금지 — 헌장 §5 모달 탈출). 도보 공지 V1은 이 공지가 대체했으므로 식별자가 남지 않는다.
 */

const ROOT = join(__dirname, "../../..");
const APP = join(ROOT, "ios/Gildongmu");
const SKIP = new Set(["build", ".build", "DerivedData", "node_modules", ".git"]);

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
const read = (path: string) => readFileSync(path, "utf8");
/** 주석 줄(`//`·`///`)을 뺀 코드 줄만 — 계약 설명 주석에 적힌 식별자·금지 문구는 판정 대상이 아니다. */
const codeOnly = (source: string) =>
  source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

describe("2.0 공지 배선", () => {
  it("도보 공지 V1 식별자가 iOS 소스에 남아 있지 않다", () => {
    const offenders = swiftFiles(join(ROOT, "ios")).filter((f) =>
      /WalkGuideNotice|walkGuideNoticeV1|walkNoticePresented/.test(codeOnly(read(f))),
    );
    expect(offenders).toEqual([]);
  });

  it("공지는 루트 시트 한 자리에서 띄우고, 저장은 확인 클로저 안에서만 한다", () => {
    const app = read(join(APP, "GildongmuApp.swift"));
    expect(app.split(".sheet(isPresented: $releaseNoticePresented)").length - 1).toBe(1);
    // 저장 호출은 ReleaseNoticeSheet의 onConfirm 클로저 안 한 번뿐이다.
    const saves = swiftFiles(join(ROOT, "ios")).flatMap((f) =>
      (read(f).match(/set\(true, forKey: ReleaseNotice\.key\)/g) ?? []).map(() => f.split("/").pop()),
    );
    expect(saves).toEqual(["GildongmuApp.swift"]);
    expect(app).toMatch(
      /ReleaseNoticeSheet \{\s*UserDefaults\.standard\.set\(true, forKey: ReleaseNotice\.key\)\s*releaseNoticePresented = false\s*\}/,
    );
    // 미확인이면 앱 수명 1회 판정에서 켠다.
    expect(app).toMatch(/if !ReleaseNotice\.confirmed \{\s*releaseNoticePresented = true\s*\}/);
  });

  it("공지 시트는 탈출 제스처를 막지 않는다", () => {
    expect(codeOnly(read(join(APP, "ReleaseNoticeSheet.swift")))).not.toContain("interactiveDismissDisabled");
    expect(codeOnly(read(join(APP, "GildongmuApp.swift")))).not.toContain("interactiveDismissDisabled");
  });

  it("공지 문자열 키 10개가 6로케일에 같다", () => {
    const KEYS = ["title", "intro", "head1", "body1", "body2", "body3", "head2", "body4", "body5", "confirm"];
    for (const locale of ["ko", "en", "ja", "es", "fr", "it"]) {
      const extra = JSON.parse(read(join(ROOT, `ios/i18n/ios-extra/${locale}.json`)));
      expect(Object.keys(extra.ios.releaseNotice), locale).toEqual(KEYS);
      expect(extra.ios.directions.walkNotice, locale).toBeUndefined();
    }
  });
});
