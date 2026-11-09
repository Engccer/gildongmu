// 도보·자동차 안내 시트의 정보 띠(E81, 위원장 판정 2026-11-10) 배선 가드.
// 뷰 계층은 테스트 레인이 없어 소스로 잠근다. 판정 정본은 docs/BACKLOG.md 종결 표와 CHANGELOG 2026-11-10.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "../../../ios/Gildongmu/Directions");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
const BEACON = read("BeaconTrackingSheet.swift");
const ROW = read("GuideTitleActionsRow.swift");

describe("안내 시트 정보 띠 (E81)", () => {
  it("띠는 남은 거리·지금 할 행동·다음 예고 셋이고, 현재 도로·주석 줄은 띠가 아니다", () => {
    expect(BEACON).toContain("enum InfoBand: Hashable { case remaining, action, next }");
    expect(BEACON).toMatch(/case \.remaining: \.remaining\s*case \.liveTop, \.status: \.action\s*case \.refresh, \.arrived, \.healthSummary: nil/);
    // 띠를 직접 붙이는 자리는 착지 대상이 아닌 다음 예고 하나다(나머지는 착지 헬퍼가 붙인다).
    expect(BEACON.match(/GuideInfoBand\(style: bandStyle\(/g) ?? []).toHaveLength(1);
    expect(BEACON).toContain("distanceText(next).foregroundStyle(.secondary)\n                            .modifier(GuideInfoBand(style: bandStyle(.next)))");
    expect(BEACON).toMatch(/let road = model\.currentRoadText \{\s*distanceText\(road\)\s*\}/);
  });

  it("몫은 1 : 2 : 1이고 없는 줄의 몫은 지금 할 행동이 받는다", () => {
    expect(BEACON).toContain("case .remaining, .next: return 1");
    expect(BEACON).toContain("case .action: return 4 - (bandExists(.remaining) ? 1 : 0) - (bandExists(.next) ? 1 : 0)");
    expect(BEACON).toContain("minHeight: bandTotal.map { $0 * bandWeight(band) / 4 }");
  });

  it("띠 전체가 한 접근성 객체이고 착지 바인딩은 그 바깥에 붙는다", () => {
    expect(ROW).toMatch(/\.contentShape\(Rectangle\(\)\)[\s\S]*\.accessibilityElement\(children: \.combine\)/);
    expect(BEACON).toMatch(/\.modifier\(GuideInfoBand\(style: Self\.band\(of: target\)\.map\(bandStyle\)\)\)\s*\.accessibilityFocused\(\$focusedRow, equals: target\)/);
  });

  it("높이 재계산은 가라앉은 뒤 한 번이고, 지금 렌더되는 띠만 더한다", () => {
    // 즉시 계산은 새 띠 높이와 옛 내용 높이를 짝지어 배정이 끝없이 자란다(실기기 멈춤 실측).
    expect(BEACON).not.toMatch(/listMetrics = metrics\s*rebalanceBands\(\)/);
    expect(BEACON).toContain(".onChange(of: bandActual) { scheduleRebalance() }");
    expect(BEACON).toContain("let rendered = bandActual.filter { bandExists($0.key) }");
    expect(ROW).not.toContain("onGone");
  });

  it("안내 종료 두 배 높이는 도보·자동차 시트뿐이다", () => {
    expect(BEACON).toContain("GuideStopButton(tall: true, action: onStop)");
    expect(read("TransitTrackingSheet.swift")).toContain("GuideStopButton(tall: false, action: onStop)");
    expect(read("JourneySheet.swift")).toContain("GuideStopButton(tall: false)");
  });
});
