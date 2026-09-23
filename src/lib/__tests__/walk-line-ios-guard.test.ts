import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * iOS 도보 줄(E42) 배선 소스 가드 — 뷰·모델 계층은 테스트 레인이 없어 배선을 소스로 잠근다
 * (CLAUDE.md "뷰 계층은 테스트 레인이 없어 배선을 소스 가드로 잠근다", 구현 리뷰 m1·M1).
 */
const read = (p: string) => readFileSync(p, "utf8");
const BEACON = "ios/Gildongmu/Directions/BeaconModel.swift";
const TAB = "ios/Gildongmu/Directions/DirectionsTabView.swift";

/** `name`으로 시작하는 func 본문(다음 `    func `/`    private func ` 전까지). */
function funcBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, signature).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start + signature.length);
  const next = rest.search(/\n    (?:private |fileprivate )?func /);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("iOS 도보 줄 배선(E42)", () => {
  it("세션 요청 축·줄 종류는 시작(begin)과 전환 커밋(commitLineSwitch)에서만 바뀐다", () => {
    const src = read(BEACON);
    for (const field of ["sessionVariant", "sessionLine", "alternateLine"]) {
      const writes = src.match(new RegExp(`\\b${field} = `, "g")) ?? [];
      expect(writes.length, field).toBe(2);
      expect(funcBody(src, "private func begin(")).toContain(`${field} = `);
      expect(funcBody(src, "private func commitLineSwitch(")).toContain(`${field} = `);
    }
    // 커밋은 계단 회피 축도 함께 바꾸고 복구 재시작 인자를 동기화한다(A13).
    const commit = funcBody(src, "private func commitLineSwitch(");
    expect(commit).toContain("accessible = target.accessible");
    expect(commit).toContain("syncStartRequestWithSession()");
  });

  it("두 전환 경로(수동 전환·프리뷰 채택)가 모두 commitLineSwitch를 지난다", () => {
    const src = read(BEACON);
    expect(funcBody(src, "private func performReroute(")).toContain("commitLineSwitch(to: target)");
    expect(funcBody(src, "func adoptAlternativePreview(")).toContain("commitLineSwitch(to: target)");
  });

  it("프리뷰 헤더는 이름을 못 받은 응답에 경고 문장을 싣는다(구현 리뷰 M1·접근성 감사 M2)", () => {
    const header = funcBody(read(BEACON), "func alternativePreviewHeaderText(");
    expect(header).toContain("fetched.lineKind == nil ? fetched.stepFreeNotice : nil");
  });

  it("조회 화면 줄의 안내 시작은 줄 종류의 투영 셋을 함께 싣는다(최단 버튼이 큰길을 시작하지 않게)", () => {
    const src = read(TAB);
    expect(src).toContain("accessible: kind.accessible, variant: kind.variant,");
    expect(src).toContain("line: kind,");
  });
});
