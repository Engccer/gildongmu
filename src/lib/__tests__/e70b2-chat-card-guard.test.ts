// E70-b2 — iOS 채팅 여정 카드 판정 반영의 소스 가드(뷰 계층은 테스트 레인이 없어 배선을 소스로 잠근다).
// 판정 ③ 수동 위치 카드에도 [안내 시작]을 두고 실제 위치로 다시 조회한다 · ④ [길찾기에서 열기] 뒤 커서는 여정 결과 첫머리, 통지 없이 진동만.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const IOS = join(process.cwd(), "ios/Gildongmu");
const card = readFileSync(join(IOS, "Chat/JourneyChatCardView.swift"), "utf8");
const tab = readFileSync(join(IOS, "Directions/DirectionsTabView.swift"), "utf8");
const rows = readFileSync(join(IOS, "Directions/JourneyResultRows.swift"), "utf8");
const webDirections = readFileSync(join(process.cwd(), "src/components/DirectionsView.tsx"), "utf8");

/** `marker`로 시작하는 함수·뷰 본문(다음 4칸 들여쓰기 닫는 중괄호까지). */
function body(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n    }\n", start);
  return src.slice(start, end);
}

describe("E70-b2 ③ 수동 위치 카드", () => {
  it("[안내 시작] 버튼을 수동 위치 여부로 가리지 않는다", () => {
    const view = body(card, "var body: some View {");
    expect(view).toContain('appLocalized("beacon.start")');
    expect(view).not.toContain("manualOrigin");
  });

  it("수동 위치 카드는 신선해도 카드의 결과로 시작하지 않고 다시 조회로 넘긴다", () => {
    const start = body(card, "private func start(");
    expect(start).toContain("guard freshness == .fresh, !payload.manualOrigin else {");
    // 그 가드가 `startJourney`보다 앞이다.
    expect(start.indexOf("!payload.manualOrigin else {")).toBeLessThan(start.indexOf("startJourney("));
    // 측위는 수동 위치 스토어를 거치지 않는 실측위다.
    expect(start).toContain("LocationService.shared.currentCoordinate(force: true)");
    expect(start).not.toContain("ManualLocationJudge");
  });

  it("다시 조회로 넘긴 프리필만 기기 위치로 풀고, 그 조회는 수동 위치 스토어를 거치지 않는다", () => {
    expect(body(card, "private func openInDirections(")).toContain("realOrigin: requery,");
    // 1회 소비: 프리필 자동 조회가 가져가고 비운다(다음 조회는 종전대로 유효 위치다).
    const prefill = body(tab, "func runPrefillQueryIfPending()");
    expect(prefill).toContain("pendingJourneyRealOrigin = false");
    expect(prefill).toContain("runQuery(realOrigin: realOrigin)");
    // 호출 자리는 그 하나다 — 다른 조회가 수동 위치를 건너뛰지 않는다.
    expect(tab.match(/runQuery\((?!silently: Bool)[^)]*realOrigin:/g)).toEqual(["runQuery(realOrigin:"]);
    const query = body(tab, "private func performQuery(");
    expect(query).toContain("usedManualOrigin = !realOrigin && from == .current");
    expect(query).toMatch(/if realOrigin \{\s+current = try await LocationService\.shared\.currentCoordinate\(force: false\)/);
  });
});

describe("E70-b2 ③ 웹 길찾기 화면", () => {
  it("기기 위치로 푸는 조회는 카드 진입의 재조회 하나뿐이다(최근 경로·조회 버튼·도구는 유효 위치 그대로)", () => {
    const sites = webDirections.split("\n").filter((line) => line.includes("realOrigin: true"));
    expect(sites).toHaveLength(1);
    expect(sites[0]).toContain('from: { kind: "current" }, to: initialTo');
  });
});

describe("E70-b2 ④ [길찾기에서 열기] 뒤 착지", () => {
  it("조회 없이 선 결과는 통지 없이 진동만 내고 착지를 요청한다", () => {
    const consume = body(tab, "func consumeJourneyCardLandingIfPending()");
    expect(consume).toContain("ResultHaptic.fire(.success)");
    expect(consume).not.toContain("announce(");
    expect(consume).not.toContain("readySummary");
    // 프리필 소비 자리에 완료 통지가 되살아나지 않는다.
    expect(body(tab, "func runPrefillQueryIfPending()")).not.toContain("readySummary");
    expect(tab).toContain("if model.consumeJourneyCardLandingIfPending() { landJourneyCardFocus() }");
  });

  it("착지 대상은 고른 변형의 제목이고, 변형이 하나면 결과의 첫 줄이다", () => {
    expect(tab).toContain("landingFocus: $journeyLandingFocused");
    expect(rows).toMatch(/Text\(heading\(variant\)\)\s+\.accessibilityAddTraits\(\.isHeader\)\s+\.accessibilityFocused\(landingFocus\)/);
    expect(rows).toContain("landing(Text(line), single && index == 0)");
    expect(rows).toContain("landing(Text(totalsLine), single && missingLines.isEmpty)");
  });
});
