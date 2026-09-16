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
  IOS_EXTRA_DIR,
  hasStrayPercent,
} from "../../../android/scripts/messages-to-android-strings.mjs";
import { collectArgOrder, diffArgOrder, ARG_ORDER_PATH as IOS_ARG_ORDER_PATH } from "../../../ios/scripts/messages-to-xcstrings.mjs";

/**
 * 안드로이드 앱 문자열 드리프트 가드(spec 2026-09-16-android-app-design §6). 생성물 `res/values(-lang)/strings.xml`은
 * `messages/*.json` + `android/i18n/android-extra`에서 나온다 — 여기서 (1) 생성물이 최신인지 (2) ko 인자 순서
 * manifest가 정본과 같고 iOS manifest와 공유 키 순서가 같은지 (3) XML을 되읽으면 빌더 값과 같은지(이스케이프·
 * 양끝 공백 회귀) (4) android-extra의 모든 `android.X`가 ios-extra `ios.X`와 6로케일 같은지(한 앱의 두 플랫폼이 다른 말을
 * 하지 않는다 — 의도된 차이는 아래 명시 목록) (5) 거부 키(인자 0의 `%%`, `%%`·`%N$s` 밖의 `%`)가 없는지 (6) ios-extra
 * `ios.` 접두 키가 `android.`로 개명돼 들어오고 웹 오버라이드 키는 들어오지 않는지 (7) 개명 키의 ko 인자 순서가 iOS
 * manifest의 `ios.X`와 같은지를 매 커밋 본다(M2 spec §7).
 */
type Order = Record<string, string[]>;
type Flat = Record<string, string>;
/** android-extra가 ios-extra와 문안이 다른 키와 그 사유. 여기 없는 차이는 드리프트다. */
const INTENDED_DIFFERENCES: Record<string, string> = {
  "android.common.geoDeniedDesc": "iOS '설정 앱에서' → 안드로이드 '설정에서'(설정 경로가 다르다)",
  "android.common.geoReducedDesc": "iOS 문장은 iOS 설정 경로(개인정보 보호 및 보안…)라 안드로이드 문안 별도",
  "android.nearby.subwayEmptyNearest": "문안 동일, iOS 지정자 %@ → 명명 플레이스홀더 {station}·{distance}",
  "android.nearby.subwayClosed": "문안 동일, iOS 지정자 %@ → {time}",
};
function flatten(obj: unknown, prefix = ""): Flat {
  const out: Flat = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flatten(v, key));
    else out[key] = String(v);
  }
  return out;
}

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

  it("android-extra의 android.X 문안은 ios-extra ios.X와 6로케일 같다(의도된 차이는 명시 목록)", () => {
    const drift: string[] = [];
    const differing = new Set<string>();
    for (const locale of LOCALES) {
      const android = flatten(JSON.parse(readFileSync(join(EXTRA_DIR, `${locale}.json`), "utf8")));
      const ios = flatten(JSON.parse(readFileSync(join(IOS_EXTRA_DIR, `${locale}.json`), "utf8")));
      for (const [key, value] of Object.entries(android)) {
        if (!key.startsWith("android.")) continue;
        const iosKey = `ios.${key.slice("android.".length)}`;
        if (!(iosKey in ios)) continue;
        if (ios[iosKey] === value) continue;
        differing.add(key);
        if (!(key in INTENDED_DIFFERENCES)) drift.push(`${locale}/${key}`);
      }
    }
    expect(drift).toEqual([]);
    // 목록에 있는데 어느 로케일에서도 다르지 않으면 낡은 항목이다
    expect(Object.keys(INTENDED_DIFFERENCES).filter((k) => !differing.has(k))).toEqual([]);
  });

  it("거부 키가 없다(인자 0의 %%, %%·%N$s 밖의 %)", () => {
    expect(built.rejected).toEqual([]);
    expect(hasStrayPercent("습도 %1$s%%")).toBe(false);
    expect(hasStrayPercent("가장 가까운 역은 %@, %@ 거리입니다")).toBe(true);
    expect(hasStrayPercent("100%")).toBe(true);
    const fake = { catalog: { strings: { "x.y": { localizations: { ko: { stringUnit: { value: "a %@ b" } } } } } }, skipped: [], argOrder: {} };
    const empty = { catalog: { strings: {} }, skipped: [], argOrder: {} };
    expect(buildAndroidStrings(fake as never, empty as never).rejected).toEqual(["x.y/ko: %%·%N$s 밖의 %"]);
  });

  it("ios-extra의 ios. 접두 키만 android.로 개명돼 들어오고 웹 오버라이드는 들어오지 않는다", () => {
    expect(built.strings.ko["android.nearby.subway"]).toBe("지하철 도착");
    expect(built.strings.en["android.nearby.subway"]).toBe("Subway arrivals");
    expect(built.imported.length).toBeGreaterThan(100);
    expect(built.ignoredIosOverrides).toBeGreaterThan(0);
    expect(built.strings.ko["dataSources.walkHealth"]).toBeUndefined();
    // %@ 원문 키는 android-extra 재작성본이 이긴다
    expect(built.strings.ko["android.nearby.subwayEmptyNearest"]).toBe("주변에 지하철역이 없습니다. 가장 가까운 역은 %1$s, %2$s 거리입니다");
    expect(built.strings.ko["android.nearby.subwayClosed"]).toBe("운행 시간이 아닙니다. 첫차 %1$s");
  });

  it("개명 키의 ko 인자 순서는 iOS manifest의 ios.X와 같다", () => {
    const ios = JSON.parse(readFileSync(IOS_ARG_ORDER_PATH, "utf8")) as Order;
    const mismatched: string[] = [];
    for (const [key, order] of Object.entries(built.argOrder)) {
      if (!key.startsWith("android.")) continue;
      const iosKey = `ios.${key.slice("android.".length)}`;
      if (!(iosKey in ios)) continue;
      if (ios[iosKey].join(",") !== order.join(",")) mismatched.push(key);
    }
    expect(mismatched).toEqual([]);
    expect(Object.keys(built.argOrder).filter((k) => k.startsWith("android.")).length).toBeGreaterThan(30);
  });
});
