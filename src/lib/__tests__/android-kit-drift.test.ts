import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DISTANCE_CASES } from "./format.test";
import { renderKitStrings, argOrderMismatches, OUTPUT_PATH } from "../../../android/scripts/messages-to-kit-strings.mjs";

/**
 * 안드로이드 :kit 드리프트 가드 3종(웹·iOS 사이의 `format-drift`·`korea-boundary-drift` 관례를 세 번째 미러로 넓힌다).
 * 1. 국경 링 리소스가 웹 정본과 바이트 동일(Kotlin `CoverageTest`도 같은 것을 보지만 vitest가 매 커밋 잡는다)
 * 2. :kit 문자열 카탈로그가 생성 스크립트 출력과 byte-identical이고, Kit xcstrings와 값 단위로 대응
 * 3. 거리 표기 경계표가 Kotlin 테스트 표와 같다(Swift 표는 `format-drift.test.ts`가 본다)
 */
const BOUNDARY_WEB = "src/lib/data/korea-boundary.json";
const BOUNDARY_KIT = "android/kit/src/main/resources/korea-boundary.json";
const KIT_XCSTRINGS = "ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings";
const KOTLIN_FORMAT_TEST = "android/kit/src/test/kotlin/space/dodoplanet/gildongmu/kit/FormatTest.kt";

describe("안드로이드 :kit 드리프트", () => {
  it("국경 링 리소스는 웹 정본과 바이트 동일", () => {
    expect(readFileSync(BOUNDARY_KIT)).toEqual(readFileSync(BOUNDARY_WEB));
  });

  it("문자열 카탈로그는 생성 스크립트 출력과 byte-identical", () => {
    expect(argOrderMismatches()).toEqual([]);
    expect(readFileSync(OUTPUT_PATH, "utf8")).toBe(renderKitStrings());
  });

  it("문자열 카탈로그는 Kit xcstrings와 키·값이 대응한다(지정자만 %@→%s)", () => {
    const kotlin = JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as { strings: Record<string, Record<string, string>> };
    const swift = JSON.parse(readFileSync(KIT_XCSTRINGS, "utf8")) as {
      strings: Record<string, { localizations?: Record<string, { stringUnit: { value: string } }> }>;
    };
    expect(Object.keys(kotlin.strings).sort()).toEqual(Object.keys(swift.strings).sort());
    const diffs: string[] = [];
    for (const [key, byLang] of Object.entries(kotlin.strings)) {
      for (const [lang, value] of Object.entries(byLang)) {
        const swiftValue = swift.strings[key]?.localizations?.[lang]?.stringUnit.value;
        if (swiftValue === undefined || swiftValue.replace(/%(\d+)\$@/g, "%$1$s") !== value) diffs.push(`${key}/${lang}`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it("거리 표기 경계표가 Kotlin 테스트 표와 같다", () => {
    const source = readFileSync(KOTLIN_FORMAT_TEST, "utf8");
    const block = /val distanceCases: List<Pair<Int, String>> = listOf\(([\s\S]*?)\n\)/.exec(source);
    if (!block) throw new Error(`${KOTLIN_FORMAT_TEST}에서 distanceCases 표를 찾지 못했다`);
    const cases = [...block[1].matchAll(/(\d+) to "([^"]+)"/g)].map((m) => [Number(m[1]), m[2]]);
    expect(cases).toEqual(DISTANCE_CASES);
  });
});
