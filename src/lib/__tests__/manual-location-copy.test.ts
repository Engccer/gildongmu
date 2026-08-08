import { describe, expect, it } from "vitest";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import it_ from "../../../messages/it.json";
import ja from "../../../messages/ja.json";

const LOCALES = { ko, en, es, fr, it: it_, ja } as Record<string, Record<string, unknown>>;
const KEYS = [
  "gps", "locating", "gpsFailed", "manual", "manualUnverifiable",
  "clear", "useGps", "autoCleared", "guideNeedsRealLocation",
];

describe("manualLocation 문구", () => {
  it.each(Object.keys(LOCALES))("%s에 9키가 전부 있다", (locale) => {
    const ns = LOCALES[locale].manualLocation as Record<string, string> | undefined;
    expect(ns).toBeDefined();
    for (const k of KEYS) expect(typeof ns![k]).toBe("string");
  });

  it.each(Object.keys(LOCALES))("%s의 수동 문구에 '현재 위치' 계열 표현이 없다", (locale) => {
    const ns = LOCALES[locale].manualLocation as Record<string, string>;
    // 수동 상태 문구가 GPS 상태 문구와 같은 말을 쓰면 시각장애 사용자가
    // 위치 출처를 구분할 수 없다.
    expect(ns.manual).not.toBe(ns.gps);
    expect(ns.manualUnverifiable).not.toBe(ns.gps);
    expect(ns.manual).toContain("{label}");
    expect(ns.manualUnverifiable).toContain("{label}");
  });
});
