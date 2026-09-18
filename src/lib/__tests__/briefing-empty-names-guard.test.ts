import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 앱 타깃에는 Swift 뷰 테스트 레인이 없다. Kit의 부재 판정이 실제 문구 조립에
// 연결되는 경계를 잠근다. 부재·공백·원문 보존의 동작은 집중 Swift 테스트가 검증한다.
const swift = readFileSync(join(__dirname, "../../../ios/Gildongmu/RouteBriefing.swift"), "utf8")
  .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
const start = swift.indexOf("func transitLegText(");
const text = swift.slice(start, swift.indexOf("\n}\n", start));

describe("브리핑 빈 이름 문구 배선", () => {
  it("한국어와 영문을 고르기 전에 같은 부재 판정을 한다", () => {
    const pick = text.slice(text.indexOf("func pick("), text.indexOf("let fromName ="));
    expect(pick).toMatch(/let ko = transitBriefingName\(ko\)/);
    expect(pick).toMatch(/let en = transitBriefingName\(en\)/);
    expect(pick.indexOf("transitBriefingName(en)")).toBeLessThan(pick.indexOf("switch names"));
    expect(text).toContain("let fromName = pick(leg.fromName, leg.fromNameEn)");
    expect(text).toContain("let toName = pick(leg.toName, leg.toNameEn)");
    expect(text).toContain('fromName.map { appLocalized("ios.route.board", $0) }');
    expect(text).toContain('toName.map { appLocalized("ios.route.alight", $0) }');
    expect(text).not.toMatch(/leg\.(fromName|toName)\.map/);
  });

  it("도보 목적지 폴백도 공백을 이름으로 쓰지 않는다", () => {
    expect(text).toContain("let name = toName ?? transitBriefingName(destinationName)");
    expect(text).toMatch(/TransitWalkLegText\.resolve\(\s*name: name,/);
  });

  it("노선명은 원문 보존 부재 판정을 거친다", () => {
    expect(text).toContain("let lineName = transitBriefingName(lineNameRaw)");
    expect(text).not.toContain("trimmingCharacters");
  });

  it("구간·하차·로터 이름이 기존 공통 영어 자격을 유지한다", () => {
    expect(swift).toContain("guard transitLegUsesEnglish(leg, lang: AppLanguage.dataLocaleValue)");
    expect(swift).toContain("station: transitAlightStationName(leg, lang: AppLanguage.dataLocaleValue)");
    expect(swift).toContain("let usesEnglish = transitLegUsesEnglish(legs[legIndex], lang: AppLanguage.dataLocaleValue)");
    expect(swift).toContain("let english = usesEnglish ? station.nameEn : nil");
    expect(swift).not.toMatch(/station:\s*leg\.toName/);
  });
});
