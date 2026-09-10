import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 체중 입력 권유의 무시 상한(E31, spec 2026-09-11) 중 **뷰 계층 배선**을 소스로 잠근다.
 *
 * Kit `WalkHealthTests`가 지키는 것은 순수 술어 둘의 값뿐이고, 그 술어를 화면이 어떻게
 * 부르는지는 앱 타깃이라 테스트 레인이 없다. 리뷰가 실제로 결함을 찾은 자리가 바로 그
 * 사각이었다(응답 표식이 `@State`라 시트 최소화가 지웠다) — 그래서 **술어가 아니라 배선**을
 * 잠근다. `beacon-tuning-wiring`·`guidance-gate-drift` 관례.
 */
const sheet = readFileSync(
  new URL("../../../ios/Gildongmu/Directions/BeaconTrackingSheet.swift", import.meta.url),
  "utf8",
);

/** [닫기] 버튼의 액션 블록 본문(섹션 마지막 행이라 그 뒤가 `} header:`다). */
const closeButtonBody = (() => {
  const start = sheet.indexOf('appLocalized("actions.close")');
  if (start < 0) throw new Error("[닫기] 버튼을 찾지 못했다 — 라벨 키가 바뀌었는가");
  const end = sheet.indexOf("} header:", start);
  if (end < 0) throw new Error("[닫기] 뒤의 섹션 헤더를 찾지 못했다 — 화면 구조가 바뀌었는가");
  return sheet.slice(start, end);
})();

describe("체중 입력 권유 무시 상한 — 뷰 배선 (E31)", () => {
  it("응답 표식은 뷰 상태가 아니라 영속 상태다", () => {
    // 루트가 `.sheet(item: presentedScreen)` 하나이고 `presentedScreen`이
    // `isMinimized ? nil : screen`이라, 최소화하면 콘텐츠 뷰가 파괴되고 `@State`가 사라진다.
    // 그러면 [체중 입력하기]를 누른 뒤 접었다 편 화면이 무시로 계상된다(spec §4).
    expect(sheet).toMatch(/@AppStorage\(WalkHealth\.weightPromptEngagedKey\)[^\n]*weightPromptEngaged/);
    expect(sheet).not.toMatch(/@State[^\n]*weightPromptEngaged/);
  });

  it("카운터에 대입하는 자리는 한 곳뿐이다", () => {
    // 세면 안 되는 소거 경로(최소화·스와이프·30분 만료·인계)는 전부 `clearArrival()` 직행이라
    // 카운터를 지나지 않는다. 새 대입 지점이 생기면 그 전제가 조용히 깨진다.
    const assignments = sheet.match(/^\s*weightPromptDismissals\s*=/gm) ?? [];
    expect(assignments).toHaveLength(1);
  });

  it("[닫기]에서 카운터 갱신이 clearArrival()보다 앞이다", () => {
    // 순서가 load-bearing이다: `clearArrival()`이 먼저 돌면 `arrivalHealth`가 nil이 되어
    // `showsWeightPrompt`가 false로 떨어지고, 카운터가 **영영 오르지 않아** 기능이 조용히 죽는다.
    const counter = closeButtonBody.indexOf("nextWeightPromptDismissals");
    const clear = closeButtonBody.indexOf("model.clearArrival()");
    expect(counter).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(-1);
    expect(counter).toBeLessThan(clear);
  });

  it("[닫기]가 응답 표식을 소비한다", () => {
    // 소비 지점이 없으면 한 화면의 응답이 다음 화면으로 새어 무시가 영영 안 세진다.
    // 소비가 `clearArrival()`의 앞인지 뒤인지는 무관하다(같은 클로저, 서로를 읽지 않는다) —
    // 버튼 블록 안에 있기만 하면 된다.
    expect(closeButtonBody).toMatch(/weightPromptEngaged\s*=\s*false/);
  });

  it("두 벌 키가 모두 화면에 남아 있다", () => {
    // 위원장 2026-09-10 문안 판정의 보이는 절반이다 — 분기를 지워도 Kit 테스트·빌드·린트가
    // 전부 초록이라 이 단언만이 회귀를 잡는다.
    expect(sheet).toContain('"ios.beacon.healthSummaryWithWeight"');
    expect(sheet).toContain('"ios.beacon.healthSummary"');
  });
});
