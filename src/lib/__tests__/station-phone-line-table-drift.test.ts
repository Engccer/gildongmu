import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPRESENTATIVE_PHONE_DIGITS, REPRESENTATIVE_PHONE_PREFIXES } from "../station-phone";

/**
 * Kit `StationPhone.swift`의 노선명 표는 웹 `subway-line-names.ts` `LINE_EN`의 미러다(E44 spec §5.4-2).
 * 경유역 전화번호 선택의 노선 일치가 이 표에 달려 있어, 한쪽만 늘면 iOS만 조용히 "번호 없음"이 된다.
 */
const ROOT = join(__dirname, "../../..");
const entries = (src: string, start: string, end: string) => {
  const from = src.indexOf(start);
  const block = src.slice(from, src.indexOf(end, from));
  return new Map([...block.matchAll(/^\s*"([^"]+)":\s*"([^"]+)",\s*$/gm)].map((m) => [m[1], m[2]]));
};

describe("역 전화번호 노선 표 드리프트", () => {
  const web = entries(readFileSync(join(ROOT, "src/lib/subway-line-names.ts"), "utf8"), "const LINE_EN", "};");
  const kit = entries(
    readFileSync(join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift"), "utf8"),
    "let subwayLineIdentityTable",
    "\n]",
  );

  it("Kit 표 항목이 웹 LINE_EN과 같다", () => {
    expect(web.size).toBeGreaterThan(50);
    expect([...kit.entries()].sort()).toEqual([...web.entries()].sort());
  });

  it("웹 판정 미러(station-phone.ts)의 레이아웃 조각·대표번호 상수가 Kit과 같다", () => {
    const swift = readFileSync(join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift"), "utf8");
    const ts = readFileSync(join(ROOT, "src/lib/station-phone.ts"), "utf8");
    for (const token of ['"transit-stop:"', '"지하철,전철"', '"지하철출구"', '"기차역"']) {
      expect(swift).toContain(token);
      expect(ts).toContain(token);
    }
    const prefixes = swift.match(/\[("[0-9]+"(?:, "[0-9]+")*)\]\.contains\(String\(digits\.prefix\(2\)\)\)/);
    expect(prefixes?.[1].split(", ").map((s) => JSON.parse(s))).toEqual(REPRESENTATIVE_PHONE_PREFIXES);
    expect(swift).toContain(`digits.count == ${REPRESENTATIVE_PHONE_DIGITS}`);
  });

  it("ODsay 관측 노선명은 전부 표 키를 가진다", () => {
    const observed = JSON.parse(
      readFileSync(join(ROOT, "src/lib/__tests__/fixtures/odsay-lane-names-observed.json"), "utf8"),
    ).lanes as { nameKor: string }[];
    const key = (ko: string) =>
      ko.trim().replace(/[\s.]/g, "").replace(/^수도권/, "").replace(/\(급행\)$/, "");
    expect(observed.filter((l) => !kit.has(key(l.nameKor))).map((l) => l.nameKor)).toEqual([]);
  });
});
