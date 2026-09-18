import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const SOURCE = readFileSync(join(ROOT, "ios/Gildongmu/Nearby/SubwayNearbyView.swift"), "utf8");

function arrivalLineBody(): string {
  const start = SOURCE.indexOf("func subwayArrivalLine(_ arrival: SubwayArrival, isEn: Bool) -> String {");
  const end = SOURCE.indexOf("\n}\n\n/// 내 주변 지하철 도착", start);
  expect(start, "subwayArrivalLine 함수가 없습니다").toBeGreaterThanOrEqual(0);
  expect(end, "subwayArrivalLine 함수 끝을 찾을 수 없습니다").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe("iOS 지하철 도착 방향 소스 가드 (B11)", () => {
  it("한국어 문장형과 원문 경로가 웹과 같은 line-direction 순서를 쓴다", () => {
    const body = arrivalLineBody();
    expect(body).toContain("let lineAndDirection = arrival.line.map { joinText($0, arrival.direction) } ?? arrival.direction");

    const prose = body.slice(body.indexOf("return TransitDisplay.pickLine("));
    expect(prose).toContain("ko: joinText(lineAndDirection, express, arrival.trainLineNm, prose)");

    const raw = body.slice(body.indexOf("let ko = joinText("));
    expect(raw).toContain("lineAndDirection, express, arrival.trainLineNm, arrival.message");
  });

  it("line nil과 빈 direction은 lineAndDirection 조각에서 joinText 정책을 따른다", () => {
    const body = arrivalLineBody();
    const declaration = "let lineAndDirection = arrival.line.map { joinText($0, arrival.direction) } ?? arrival.direction";
    expect(body.split(declaration)).toHaveLength(2);
    expect(body).not.toContain("joinText(arrival.line, arrival.direction, express");
  });
});
