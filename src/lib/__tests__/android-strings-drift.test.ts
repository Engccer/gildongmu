import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAndroidStrings,
  renderStringsXml,
  parseStringsXml,
  resourceName,
  valuesDir,
  LOCALES,
  ARG_ORDER_PATH,
  EXTRA_DIR,
} from "../../../android/scripts/messages-to-android-strings.mjs";
import { collectArgOrder, diffArgOrder, ARG_ORDER_PATH as IOS_ARG_ORDER_PATH } from "../../../ios/scripts/messages-to-xcstrings.mjs";

/**
 * 안드로이드 앱 문자열 드리프트 가드(spec 2026-09-16-android-app-design §6). 생성물 `res/values(-lang)/strings.xml`은
 * `messages/*.json` + `android/i18n/android-extra`에서 나온다 — 여기서 (1) 생성물이 최신인지 (2) ko 인자 순서
 * manifest가 정본과 같고 iOS manifest와 공유 키 순서가 같은지 (3) XML을 되읽으면 빌더 값과 같은지(이스케이프·
 * 양끝 공백 회귀) (4) android-extra의 검색 문안이 ios-extra와 6로케일 같은지(한 앱의 두 플랫폼이 다른 말을 하지
 * 않는다) (5) 인자 0인데 `%%`를 담은 키가 없는지를 매 커밋 본다.
 */
type Order = Record<string, string[]>;
const SEARCH_KEYS = ["prompt", "searching", "failedTitle", "webSection", "announceFailed", "announceEmpty", "announceCount"];

describe("안드로이드 앱 문자열 드리프트", () => {
  const built = buildAndroidStrings();

  it("생성물이 최신이다(byte-identical, 6로케일)", () => {
    for (const locale of LOCALES) {
      expect(readFileSync(join(valuesDir(locale), "strings.xml"), "utf8"), locale).toBe(renderStringsXml(locale, built));
    }
  });

  it("arg-order manifest가 정본과 같고, 웹과 공유하는 키는 iOS manifest와 순서가 같다", () => {
    const manifest = JSON.parse(readFileSync(ARG_ORDER_PATH, "utf8")) as Order;
    expect(Object.keys(built.argOrder).length).toBeGreaterThan(100);
    expect(diffArgOrder(manifest, built.argOrder)).toEqual({ added: [], removed: [], changed: [] });
    const ios = JSON.parse(readFileSync(IOS_ARG_ORDER_PATH, "utf8")) as Order;
    const current = collectArgOrder() as Order;
    expect(diffArgOrder(ios, current).changed).toEqual([]);
    const shared = Object.keys(built.argOrder).filter((k) => k in ios);
    expect(shared.length).toBeGreaterThan(100);
    expect(shared.filter((k) => ios[k].join(",") !== built.argOrder[k].join(","))).toEqual([]);
  });

  it("왕복: 생성된 XML을 되읽으면 빌더 값과 같다", () => {
    for (const locale of LOCALES) {
      const parsed = parseStringsXml(renderStringsXml(locale, built));
      const expected: Record<string, string> = { app_locale: locale };
      for (const [key, value] of Object.entries(built.strings[locale])) expected[resourceName(key)] = value;
      expect(parsed, locale).toEqual(expected);
    }
  });

  it("리소스 이름은 충돌하지 않는다", () => {
    const names = Object.keys(built.strings.ko).map(resourceName);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => /^[a-z][A-Za-z0-9_]*$/.test(n))).toBe(true);
  });

  it("android.search.* 문안은 ios.search.* 와 6로케일 같다", () => {
    for (const locale of LOCALES) {
      const android = JSON.parse(readFileSync(join(EXTRA_DIR, `${locale}.json`), "utf8")).android.search;
      const ios = JSON.parse(readFileSync(join("ios/i18n/ios-extra", `${locale}.json`), "utf8")).ios.search;
      for (const key of SEARCH_KEYS) expect(android[key], `${locale}/${key}`).toBe(ios[key]);
    }
  });

  it("인자 0인데 %%를 담은 키는 없다", () => {
    expect(built.rejected).toEqual([]);
  });
});
