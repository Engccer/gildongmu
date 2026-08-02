import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DISTANCE_CASES } from "./format.test";

/**
 * 거리 표기 웹-iOS 드리프트 가드.
 *
 * `formatDistance`는 웹·Kit·CLI 세 벌로 각자 구현돼 있는데 종전엔 가드가 없었다.
 * 셋이 갈리면 같은 앱에서 같은 거리가 다르게 낭독된다.
 *
 * ⚠ Swift 상수를 Swift 리터럴과 비교하는 테스트는 웹이 바뀌어도 실패하지 않는다.
 * 정본(웹 `DISTANCE_CASES`)을 Swift **테스트 파일의 표**와 교차 대조해야 드리프트가
 * 잡힌다(`beacon-tones-drift.test.ts`와 같은 정신). Swift 구현이 그 표를 지키는지는
 * Kit `FormatTests`가 본다.
 *
 * CLI 미러는 같은 프로세스에서 실행 대조가 가능하므로 CLI 패키지 테스트가 맡는다
 * (`packages/cli/src/lib/__tests__/format-drift.test.ts`).
 */

const SWIFT_TEST = "ios/GildongmuKit/Tests/GildongmuKitTests/FormatTests.swift";

/** Swift 테스트의 `distanceCases` 표에서 `(입력, "기대")` 쌍을 뽑는다. */
function swiftCases(source: string): [number, string][] {
  const block = /let distanceCases: \[\(Int, String\)\] = \[([\s\S]*?)\n\]/.exec(source);
  if (!block) {
    throw new Error(`${SWIFT_TEST}에서 distanceCases 표를 찾지 못했다`);
  }
  return [...block[1].matchAll(/\((\d+),\s*"([^"]+)"\)/g)].map((m) => [
    Number(m[1]),
    m[2],
  ]);
}

describe("거리 표기 웹-iOS 드리프트", () => {
  it("Swift 테스트의 경계표가 웹 정본과 같다", () => {
    expect(swiftCases(readFileSync(SWIFT_TEST, "utf8"))).toEqual(DISTANCE_CASES);
  });

  it("가드 자체가 살아 있다 (표를 못 찾으면 조용히 통과하지 않는다)", () => {
    expect(() => swiftCases("let distanceCases = []")).toThrow(/찾지 못했다/);
  });

  it("Swift 구현이 소수 km 표기로 되돌아가지 않았다", () => {
    // 표만 대조하면 구현이 "%.1fkm"으로 되돌아가도 Kit 테스트가 red일 뿐 여기선
    // 안 잡힌다. 되돌림의 흔적을 직접 본다.
    const impl = readFileSync(
      "ios/GildongmuKit/Sources/GildongmuKit/Format.swift",
      "utf8",
    );
    expect(impl).not.toMatch(/%\.\d*fkm/);
  });
});

/**
 * 헬퍼를 우회하고 소수 km를 **직접 조립하는 지역 사본** 금지.
 *
 * 이 가드가 없어서 실제로 네 곳이 갈려 있었다(2026-08-02 전수 발견): 웹 도보 브리핑,
 * CLI 자동차·도보 요약, iOS 자동차·도보 요약. 그중 CLI·iOS 도보는 1km 미만 분기를
 * 건너뛰어 **850m를 "0.8km"로** 내고 있었다. 표기가 갈리는 것보다 나쁜 실제 결함이다.
 *
 * 거리 표기는 언제나 `formatDistance`(웹·Kit) 또는 `dist()`(CLI)를 지난다.
 */
const SCAN_ROOTS = [
  "src",
  "ios/Gildongmu",
  "ios/GildongmuKit/Sources",
  "packages/cli/src",
  "packages/mcp/src",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    // 테스트는 옛 표기를 회귀 케이스로 적을 수 있어 제외한다.
    if (name === "__tests__" || name === "Tests" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|swift)$/.test(name)) out.push(full);
  }
  return out;
}

describe("소수 km 지역 사본 금지", () => {
  // TS 판은 `(x / 1000).toFixed(n)`, Swift 판은 `String(format: "%.1f", ... / 1000)`.
  // ⚠ Swift 쪽 사이 구간을 `[^)]*`로 두면 안 된다. 실제 코드가
  // `Double(briefing.distanceMeters) / 1000`처럼 **괄호를 품고** 있어 매칭이 끊긴다
  // (아래 자기 검증 테스트가 이 실수를 실제로 잡았다). 같은 줄로만 한정한다.
  const BYPASS = [/\/\s*1000\s*\)\s*\.toFixed\s*\(/, /"%\.\d+f"\s*,[^;\n]*\/\s*1000/];

  // Swift 문자열 보간으로 미터를 직접 조립하는 꼴(`…\(x)m"`). 소수 km 조립만 잡던
  // 종전 가드의 사각지대로, 따릉이·지하철·버스 행과 자동차 스텝 4곳이 이 꼴로
  // formatDistance를 우회했다(버스·자동차는 1km 초과가 "1200m"로 표기되던 실결함,
  // 2026-08-02 리뷰 검출). 정본 `Format.swift` 자신만 예외다.
  const SWIFT_INTERP_METERS = /\\\([^)\n]*\)k?m"/;
  const INTERP_ALLOWED = ["ios/GildongmuKit/Sources/GildongmuKit/Format.swift"];

  it("어떤 소스도 거리 km를 직접 조립하지 않는다", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, "utf8");
        if (BYPASS.some((re) => re.test(text))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("어떤 Swift 소스도 보간으로 미터를 직접 조립하지 않는다", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of sourceFiles(root)) {
        if (!file.endsWith(".swift")) continue;
        if (INTERP_ALLOWED.some((allowed) => file.endsWith(allowed))) continue;
        if (SWIFT_INTERP_METERS.test(readFileSync(file, "utf8"))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("가드 자체가 살아 있다 (패턴이 실제로 매칭된다)", () => {
    expect(BYPASS[0].test("`${(n / 1000).toFixed(1)}km`")).toBe(true);
    expect(BYPASS[1].test('String(format: "%.1f", Double(m) / 1000)')).toBe(true);
    expect(BYPASS.some((re) => re.test("formatDistance(meters)"))).toBe(false);
    // Swift 보간 가드: 실제 위반 꼴(버스 행이 정확히 이 꼴이었다)에 매칭되고,
    // 정본 경유 코드에는 매칭되지 않는다.
    expect(SWIFT_INTERP_METERS.test('Text(joinText(stop.name, "\\(stop.distanceMeters)m"))')).toBe(true);
    expect(SWIFT_INTERP_METERS.test('"\\(km)km \\(rest)m"')).toBe(true);
    expect(SWIFT_INTERP_METERS.test("formatDistance(stop.distanceMeters)")).toBe(false);
    expect(SWIFT_INTERP_METERS.test('appLocalized("place.distance", formatDistance(m))')).toBe(false);
  });
});
