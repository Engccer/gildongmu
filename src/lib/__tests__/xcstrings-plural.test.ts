import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  parseIcu,
  referencedNames,
  dedupeInOrder,
  toPositionalFormat,
  buildCatalog,
  TARGETS,
} from "../../../ios/scripts/messages-to-xcstrings.mjs";

/**
 * messages → xcstrings 변환의 ICU 복수 블록 규칙(A29, spec 2026-08-31-plural-forms-design.md §4.2).
 * 카탈로그는 `{N, plural, one {…} other {…}}`를 문자열 그대로 싣고 Kit `resolvePluralBlocks`가
 * 실행 시 푼다 — 그 계약의 생산자 쪽 가드.
 */
type Part = { kind: string; name?: string; text?: string; branches?: Record<string, Part[]> };
type CatalogStrings = Record<string, { localizations: Record<string, { stringUnit: { value: string } }> }>;

function convert(ko: string, value: string): string {
  const koParts = parseIcu(ko) as Part[] | null;
  const parts = parseIcu(value) as Part[] | null;
  if (!koParts || !parts) throw new Error(`unsupported ICU: ${value}`);
  const order = dedupeInOrder(referencedNames(koParts));
  return toPositionalFormat(parts, order);
}

describe("messages-to-xcstrings: ICU 복수 블록", () => {
  it("단순 플레이스홀더는 종전대로 %N$@", () => {
    expect(convert("장소 {count}건", "장소 {count}건")).toBe("장소 %1$@건");
    expect(convert("{a} {b}", "{b} {a}")).toBe("%2$@ %1$@");
  });

  it("plural 블록은 인덱스화되고 #은 그 인자의 %N$@", () => {
    expect(convert("장소 {count}건", "{count, plural, one {# place} other {# places}}")).toBe(
      "{1, plural, one {%1$@ place} other {%1$@ places}}",
    );
  });

  it("블록 인덱스는 ko 등장 순서를 따르고 블록 안 {name}도 인덱스화된다", () => {
    const ko = "{direction} {distance}({count}기)";
    const en = "{direction}, {distance} ({count, plural, one {# device} other {# devices}})";
    expect(convert(ko, en)).toBe("%1$@, %2$@ ({3, plural, one {%3$@ device} other {%3$@ devices}})");
    expect(convert("{n} {label}", "{n, plural, one {# {label}} other {# {label}s}}")).toBe(
      "{1, plural, one {%1$@ %2$@} other {%1$@ %2$@s}}",
    );
  });

  it("리터럴 %는 분기 안에서도 %%로 이스케이프된다", () => {
    expect(convert("{n}%", "{n, plural, one {#% off} other {#% off}}")).toBe(
      "{1, plural, one {%1$@%% off} other {%1$@%% off}}",
    );
  });

  it("태그와 plural 블록이 공존한다(legBoard)", () => {
    const ko = "<from></from>에서 <line></line> 승차, {count} 정거장";
    const en = "Board <line></line> at <from></from>, {count, plural, one {# stop} other {# stops}}";
    expect(convert(ko, en)).toBe("Board <line></line> at <from></from>, {1, plural, one {%1$@ stop} other {%1$@ stops}}");
  });

  it("공백 변형은 한 형태로 정규화된다(Swift 스캐너 계약)", () => {
    expect(convert("{count}", "{count,plural,one{# a}other{# b}}")).toBe("{1, plural, one {%1$@ a} other {%1$@ b}}");
    expect(convert("{count}", "{ count , plural ,\n  other {# b}\n  one {# a} }")).toBe(
      "{1, plural, one {%1$@ a} other {%1$@ b}}",
    );
  });

  it("ICU 아포스트로피 인용은 스킵 신호(null), 낱말 속 아포스트로피는 리터럴", () => {
    expect(parseIcu("{n, plural, one {'#' a} other {# b}}")).toBeNull();
    expect(parseIcu("{n, plural, one {'{'} other {b}}")).toBeNull();
    expect(parseIcu("it''s")).toBeNull();
    expect(convert("{count}", "{count, plural, one {C'è # fermata} other {Ci sono # fermate}}")).toBe(
      "{1, plural, one {C'è %1$@ fermata} other {Ci sono %1$@ fermate}}",
    );
  });

  it("지원 밖 구문은 스킵 신호(null)", () => {
    expect(parseIcu("{n, select, a {b} other {c}}")).toBeNull();
    expect(parseIcu("{n, plural, one {a} few {b} other {c}}")).toBeNull();
    expect(parseIcu("{n, plural, one {a}}")).toBeNull();
    expect(parseIcu("{n, plural, one {a} one {b} other {c}}")).toBeNull();
    expect(parseIcu("{n, plural, one {{m, plural, one {a} other {b}}} other {c}}")).toBeNull();
    expect(parseIcu("a } b")).toBeNull();
  });

  it("짝 없는 { 는 종전대로 리터럴", () => {
    expect(convert("a { b", "a { b")).toBe("a { b");
  });

  it("생성 카탈로그는 결정론이고 plural 키가 스킵되지 않는다", () => {
    const first = buildCatalog(TARGETS.app);
    const second = buildCatalog(TARGETS.app);
    expect(JSON.stringify(first.catalog)).toBe(JSON.stringify(second.catalog));
    expect(first.skipped).toEqual([]);
    const en = (first.catalog.strings as CatalogStrings)["search.placeCount"].localizations.en.stringUnit.value;
    expect(en).toBe("{1, plural, one {%1$@ place} other {%1$@ places}}");
    // 저장된 카탈로그가 현재 정본과 같다(재생성 누락 드리프트).
    const onDisk = JSON.parse(readFileSync(TARGETS.app.output, "utf8"));
    expect(onDisk).toEqual(first.catalog);
    const kit = buildCatalog(TARGETS.kit);
    expect(kit.skipped).toEqual([]);
    expect(JSON.parse(readFileSync(TARGETS.kit.output, "utf8"))).toEqual(kit.catalog);
  });

  // 앱 타깃은 lproj로 컴파일된 `.strings`를 읽는다(AppLocalization.swift). ICU 블록이
  // 문자열 그대로 컴파일되고 `.stringsdict`로 새지 않는지를 산출물에서 본다(spec §4.1) —
  // Kit JSON 경로 테스트는 이 경로를 증명하지 못한다(설계 리뷰 #18).
  it.skipIf(process.platform !== "darwin")("xcstringstool 컴파일 산출물에 plural 블록이 문자열 그대로 남는다", () => {
    const out = mkdtempSync(join(tmpdir(), "xcs-"));
    execFileSync("xcrun", ["xcstringstool", "compile", TARGETS.app.output, "--output-directory", out]);
    const files = readdirSync(join(out, "en.lproj"));
    expect(files).toContain("Localizable.strings");
    expect(files).not.toContain("Localizable.stringsdict");
    const json: Record<string, string> = JSON.parse(
      execFileSync("plutil", ["-convert", "json", "-o", "-", join(out, "en.lproj", "Localizable.strings")], {
        encoding: "utf8",
      }),
    );
    expect(json["search.placeCount"]).toBe("{1, plural, one {%1$@ place} other {%1$@ places}}");
    expect(json["whereAmI.overview.transitBus"]).toBe(
      "{1, plural, one {There is %1$@ bus stop.} other {There are %1$@ bus stops.}} %2$@",
    );
  });

  // 해석기를 우회하는 호출 형태를 소스에서 막는다(설계 리뷰 #9): ①plural 키를 인자 없이
  // 조회(ICU 원문이 그대로 낭독) ②`String(format:)`에 appLocalized/kitLocalized 결과를
  // 넘기는 2단계 포맷(분기 선택 없이 %N$@만 치환).
  it("Swift 소스가 plural 키를 인자 없이 조회하거나 2단계 String(format:)로 우회하지 않는다", () => {
    const root = resolve(__dirname, "..", "..", "..");
    const catalog = JSON.parse(readFileSync(TARGETS.app.output, "utf8")).strings as CatalogStrings;
    const pluralKeys = Object.entries(catalog)
      .filter(([, e]) => Object.values(e.localizations).some((l) => l.stringUnit.value.includes(", plural, ")))
      .map(([k]) => k);
    expect(pluralKeys.length).toBeGreaterThanOrEqual(40);
    const swiftFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return entry === "Tests" ? [] : swiftFiles(full);
        return entry.endsWith(".swift") ? [full] : [];
      });
    const offenders: string[] = [];
    for (const file of [...swiftFiles(join(root, "ios", "Gildongmu")), ...swiftFiles(join(root, "ios", "GildongmuKit", "Sources"))]) {
      const source = readFileSync(file, "utf8");
      const rel = file.slice(root.length + 1);
      for (const key of pluralKeys) {
        const escaped = key.replaceAll(".", "\\.");
        if (new RegExp(`appLocalized\\(\\s*"${escaped}"\\s*\\)`).test(source)) offenders.push(`${rel}: ${key} 인자 없음`);
        if (new RegExp(`kitLocalized\\(\\s*"${escaped}",\\s*lang:\\s*[^,()]+\\)`).test(source)) offenders.push(`${rel}: ${key} 인자 없음`);
      }
      for (const [i, line] of source.split("\n").entries()) {
        if (/String\(format:/.test(line) && /(appLocalized|kitLocalized)\(/.test(line)) offenders.push(`${rel}:${i + 1}: 2단계 포맷`);
      }
    }
    expect(offenders).toEqual([]);
    expect(existsSync(join(root, "ios", "Gildongmu", "AppLocalization.swift"))).toBe(true);
  });
});
