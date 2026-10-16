import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// E72 로터 동작을 화면에서도 쓰게 한다(spec 2026-10-17-e72-visible-row-actions-design.md). 뷰 계층은 테스트 레인이
// 없어 소스로 잠근다. 밀기 버튼이 VoiceOver 동작 목록에 오르는 순서는 실기기만 판정하므로 여기서는 선언 배치를 본다.

const root = resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

/** `from`부터 `to` 직전까지(둘 다 있어야 한다 — 빈 통과 금지). */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** needle들이 주어진 순서로 나오는가. */
function inOrder(source: string, needles: string[]): boolean {
  const positions = needles.map((n) => source.indexOf(n));
  return positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]);
}

describe("규칙 1·2: 장소 목록 행은 밀기 버튼, 딥링크 없음", () => {
  const search = read("ios/Gildongmu/SearchView.swift");
  const actions = slice(search, "struct PlaceRowActions: ViewModifier", "extension View {");
  const swipe = slice(actions, "case .swipe:", "case .rotor:");
  const rotor = slice(actions, "case .rotor:", "private var copyAddressButton");

  it("왼쪽 밀기는 주소 복사 → 여기까지 길찾기, 끝까지 밀기는 첫 버튼이 주소 복사일 때만", () => {
    expect(inOrder(swipe, [
      ".swipeActions(edge: .trailing, allowsFullSwipe: !place.roadAddress.isEmpty) {",
      "copyAddressButton",
      "directionsButton",
    ])).toBe(true);
  });

  it("오른쪽 밀기는 전화 → 물어보기이고 끝까지 밀기 실행이 꺼져 있다(전화는 되돌릴 수 없다)", () => {
    expect(inOrder(swipe, [".swipeActions(edge: .leading, allowsFullSwipe: false) {", "callButton", "askButton"])).toBe(true);
    expect(swipe).not.toContain("accessibilityActions");
  });

  it("로터 갈래(List 밖)는 같은 넷을 역순 선언한다 — 들리는 순서는 주소 복사 → 길찾기 → 전화 → 물어보기", () => {
    expect(inOrder(rotor, [".accessibilityActions {", "askButton", "callButton", "directionsButton", "copyAddressButton"])).toBe(true);
  });

  it("행 묶음에 카카오맵·네이버 지도 딥링크가 없다(장소 상세의 보조 출구에만)", () => {
    for (const key of ["ios.route.naver", "ios.route.kakao", "RouteDeeplink"]) expect(actions).not.toContain(key);
    expect(read("ios/Gildongmu/PlaceDetailView.swift")).toContain('appLocalized("ios.route.naver")');
  });

  it("PlaceRow는 스스로 동작을 달지 않는다 — 밀기 버튼은 행의 뿌리에 붙어야 동작한다", () => {
    const row = slice(search, "struct PlaceRow: View", "struct PlaceRowActions");
    expect(row).not.toMatch(/placeRow(Swipe)?Actions|accessibilityActions|swipeActions|onAskAbout/);
  });

  it("List 행의 PlaceRow 호출부는 전부 행 뿌리에 밀기 수정자를 단다(호출 수 = 수정자 수)", () => {
    const dir = resolve(root, "ios/Gildongmu/Nearby");
    const files = [
      "ios/Gildongmu/SearchView.swift",
      ...readdirSync(dir)
        // 주변 상황 행은 PlaceRow 없이 같은 묶음을 링크에 단다(아래에서 따로 본다).
        .filter((f) => f.endsWith(".swift") && f !== "SurroundingsSceneSection.swift")
        .map((f) => `ios/Gildongmu/Nearby/${f}`),
    ];
    let total = 0;
    for (const file of files) {
      const s = read(file);
      const rows = s.split("PlaceRow(\n").length - 1 + s.split("PlaceRow(place:").length - 1;
      const swipes = s.split(".placeRowSwipeActions(").length - 1;
      expect(swipes, file).toBe(rows);
      // 밀기 수정자는 라벨 안이 아니라 링크 뒤(`}` 다음 줄)에 온다.
      if (rows > 0) expect(s, file).toMatch(/\n\s*\}\n\s*\.placeRowSwipeActions\(/);
      total += rows;
    }
    expect(total).toBe(6); // 검색 결과 · 소아 진료 · 행사 · 아이 놀 곳 · 무장애 · 둘러보기 주변 가게
    expect(read("ios/Gildongmu/Nearby/SurroundingsSceneSection.swift")).toContain("link.placeRowSwipeActions(");
  });

  it("역 전화 밀기 버튼의 결과 문장은 VoiceOver가 꺼져 있을 때만 화면에도 뜬다(무반응 버튼 방지)", () => {
    const subway = read("ios/Gildongmu/Nearby/SubwayNearbyView.swift");
    expect(subway).toContain("if !UIAccessibility.isVoiceOverRunning { visibleNotice = text }");
    expect(subway).toMatch(/\.alert\(\s*visibleNotice \?\? ""/);
    const store = read("ios/Gildongmu/StationPhoneStore.swift");
    // 화면 통지는 VoiceOver 통지와 같은 문장이고 같은 자리에서 나간다.
    expect(store).toMatch(/AccessibilityNotification\.Announcement\(message\)\.post\(\)\s*\n\s*ResultHaptic\.fire\(appHaptic\(notice\.haptic\)\)\s*\n\s*onNotice\?\(text\)/);
  });

  it("채팅 장소 카드(ScrollView)는 같은 묶음을 로터로 단다", () => {
    const chat = read("ios/Gildongmu/Chat/ChatConversationView.swift");
    expect(chat).toContain(".placeRowActions(place, onAskAbout: nil)");
    expect(chat).not.toContain("placeRowSwipeActions");
  });
});

describe("규칙 3·4: 줄 안 대상은 이름만 링크 + 같은 대상의 로터", () => {
  it("한눈에 보기 문장: 링크와 로터가 같은 대상 목록에서 나온다", () => {
    const s = read("ios/Gildongmu/Nearby/AroundNearbyView.swift");
    expect(s).toMatch(/bilingualLine\(\s*visible: InlineTargets\.linked\(\s*AttributedString\(line\.display\), names: targets\.map\(\\\.name\),\s*avoiding: targets\.compactMap\(\\\.lineHint\)\)/);
    expect(s).toContain(".inlineTargetTaps(count: targets.count) { detailTarget = targets[$0] }");
    expect(s).toContain("ForEach(targets.reversed())");
  });

  it("브리핑 줄: 역 이름 링크는 진입점이 켜진 줄만, 링크 순번 = 동작 순번", () => {
    const s = read("ios/Gildongmu/RouteBriefing.swift");
    expect(s).toContain("BriefingStationRow(actions: actions, onOpen: onOpen, content: { content(actions.map(\\.name)) })");
    expect(s).toContain(".inlineTargetTaps(count: actions.count) { index in onOpen(actions[index].stop, actions[index].lineName) }");
    expect((s.match(/content\(\[\]\)/g) ?? []).length).toBe(2); // 옵트인 꺼짐·대상 없음은 링크 없음
    expect(s).toContain("Text(InlineTargets.linked(\n        AttributedString(line.visual), names: names, avoiding:");
    expect(s).toContain("Text(InlineTargets.linked(AttributedString(text), names: names))");
  });

  it("채팅 블록: 언급 1개 이상이면 언제나 링크 + 로터 — 블록 버튼 갈래가 없다", () => {
    const chat = read("ios/Gildongmu/Chat/ChatConversationView.swift");
    const block = slice(chat, "private func blockView(", "private func styledBlockText(");
    expect(block).not.toMatch(/\bButton \{|switch mentions\.count|contentShape/);
    expect(block).toContain("if mentions.isEmpty {");
    expect(block).toContain(".inlineTargetTaps(count: mentions.count) { onOpenPlace(mentions[$0], originKey) }");
    expect(chat).toContain("InlineTargets.linked(parsed, names: mentions.map(\\.name))");
    expect(chat).not.toContain("gildongmu-place-mention");
  });

  it("안내 시트 상태 문장: 링크는 역 정체성(viaStops 순번)에 결박되고 줄은 같은 착지 대상 Text다", () => {
    const sheet = read("ios/Gildongmu/Directions/TransitTrackingSheet.swift");
    const status = slice(sheet, "@ViewBuilder private var statusRows", "private func openStationDetail(");
    expect(status).toContain("let linkOwners = mentions.flatMap");
    expect(status).toContain("openStationDetail(viaStops[linkOwners[position]], lineName: leg.lineName, source: \"statusLink\")");
    expect(status).toContain(".inlineTargetTaps(count: linkOwners.count) { position in");
    expect(status).not.toMatch(/\bButton \{|contentShape/);
    expect(status).toContain("ForEach(Array(mentions.reversed()), id: \\.self)");
  });

  it("안내 시트 경유역 행: 행 전체 버튼(상세)은 그대로, 전화는 오른쪽 밀기·끝까지 밀기 꺼짐·VoiceOver 꺼짐이면 알림창", () => {
    const sheet = read("ios/Gildongmu/Directions/TransitTrackingSheet.swift");
    const row = slice(sheet, "private struct ViaStopStationRow: View", "\n}\n");
    expect(inOrder(row, ["Button(action: onOpen) {", ".swipeActions(edge: .leading, allowsFullSwipe: false) {", "Button(callLabel) { call() }"])).toBe(true);
    expect(row).not.toContain(".accessibilityActions");
    expect(row).toContain("if !UIAccessibility.isVoiceOverRunning { visibleNotice = text }");
    expect(row).toMatch(/\.alert\(\s*visibleNotice \?\? ""/);
  });

  it("링크 도우미: 범위는 Kit 판정(테스트 레인)을 지나고, 자체 스킴만 가로채며, 색에만 맡기지 않는다", () => {
    const s = read("ios/Gildongmu/InlineTargets.swift");
    expect(s).toContain("inlineTargetSpans(in: String(text.characters), names: names, avoiding: avoiding)");
    expect(s).toContain(".underlineStyle = .single");
    expect(s).toContain("guard let index = InlineTargets.index(of: url) else { return .systemAction }");
    // 대상 수 밖 순번은 버린다(글자와 처리기가 다른 렌더에 속하는 순간의 첨자 범위 밖 종료 방지).
    expect(s).toContain("guard (0..<count).contains(index) else { return .discarded }");
    // 브리핑 줄은 노선 이름 안의 역 이름에 걸지 않는다(「신림선」 안의 「신림」).
    expect(read("ios/Gildongmu/RouteBriefing.swift")).toContain("avoiding: [leg.lineName, leg.lineNameEn].compactMap { $0 }");
  });
});
