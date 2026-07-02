import { describe, expect, it } from "vitest";
import { hasSupportedLanguage } from "../accept-language";

const LOCALES = ["ko", "en", "es", "fr", "it"] as const;

describe("hasSupportedLanguage", () => {
  it("헤더가 없으면 true (신호 없음 → 기본 로케일 유지, 개입 안 함)", () => {
    expect(hasSupportedLanguage(null, LOCALES)).toBe(true);
    expect(hasSupportedLanguage("", LOCALES)).toBe(true);
    expect(hasSupportedLanguage("   ", LOCALES)).toBe(true);
  });

  it("지원 언어가 있으면 true (지역 변형은 기본 언어로 매칭)", () => {
    expect(hasSupportedLanguage("ko-KR,ko;q=0.9", LOCALES)).toBe(true);
    expect(hasSupportedLanguage("en-US,en;q=0.9", LOCALES)).toBe(true);
    expect(hasSupportedLanguage("fr-FR", LOCALES)).toBe(true);
    expect(hasSupportedLanguage("EN-us", LOCALES)).toBe(true);
  });

  it("미지원 언어만 있으면 false", () => {
    expect(hasSupportedLanguage("ja-JP,ja;q=0.9", LOCALES)).toBe(false);
    expect(hasSupportedLanguage("zh-CN", LOCALES)).toBe(false);
    expect(hasSupportedLanguage("de-DE, pt;q=0.5", LOCALES)).toBe(false);
  });

  it("미지원 언어 뒤에 지원 언어가 섞여 있으면 true", () => {
    expect(hasSupportedLanguage("ja-JP,ja;q=0.9,en;q=0.1", LOCALES)).toBe(true);
  });

  it("와일드카드(*)는 true (아무 언어나 허용 → 기본 로케일)", () => {
    expect(hasSupportedLanguage("*", LOCALES)).toBe(true);
    expect(hasSupportedLanguage("ja, *;q=0.1", LOCALES)).toBe(true);
  });

  it("q=0은 거부 표시이므로 매칭에서 제외", () => {
    expect(hasSupportedLanguage("en;q=0", LOCALES)).toBe(false);
    expect(hasSupportedLanguage("ja,en;q=0", LOCALES)).toBe(false);
  });
});
