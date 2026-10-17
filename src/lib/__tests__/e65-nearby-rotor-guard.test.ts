import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// E65 내 주변 로터 액션의 iOS 배선 가드(spec 2026-10-05-nearby-rotor-actions-design.md §2·§3, E72 밀기 버튼 전환은
// spec 2026-10-17-e72-visible-row-actions-design.md). 뷰 계층은 테스트 레인이 없어 소스로 잠근다. 순서는 선언 위치로 본다.

const root = resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const nearby = (file: string) => read(`ios/Gildongmu/Nearby/${file}`);

/** `anchor` 뒤에서 각 needle이 처음 나오는 위치가 주어진 순서대로 증가하는가. anchor가 없으면 실패(빈 통과 금지). */
function declaredInOrder(source: string, anchor: string, needles: string[]): boolean {
  const start = source.indexOf(anchor);
  if (start < 0) return false;
  const positions = needles.map((n) => source.indexOf(n, start));
  return positions.every((p) => p > start) && positions.every((p, i) => i === 0 || p > positions[i - 1]);
}

describe("E65 내 주변 로터 액션 배선", () => {
  it("한눈에 보기: 문장마다 불릿 구조의 대상을 역순 선언하고 기존 라벨 키만 쓴다", () => {
    const s = nearby("AroundNearbyView.swift");
    expect(s).toContain("let targets = overviewDetailTargets(bullet, lang: lang)");
    expect(s).toContain("ForEach(targets.reversed())");
    expect(s).toContain('appLocalized("transitGuide.openStation", target.name)');
    expect(s).toContain('appLocalized("ios.chat.openPlace", target.name)');
    // 행사는 목록 화면과 같은 상세(행사 섹션 포함).
    expect(s).toMatch(/PlaceDetailView\(place: target\.place, stationLineHint: target\.lineHint\) \{\s*if let event = target\.event \{ CultureEventSection\(event: event\) \}/);
  });

  it("주변 상황: 둘러보기(자동 펼침)만 PlaceRow 묶음을 단다 — 버튼형(안내 시트)은 붙이지 않는다", () => {
    const s = nearby("SurroundingsSceneSection.swift");
    expect(s).toContain("link.placeRowSwipeActions(place, onAskAbout: { rowActionsAskAbout(place) })");
    expect(s).toContain("rowActionsAskAbout: onAskAbout, onPushed: onPushed)");
    // 버튼형 호출은 rowActionsAskAbout을 넘기지 않는다(기본값 nil). 호출 전체를 공백 무관으로 잡는다.
    const buttonCall = s.match(/SurroundingsSceneGroupsView\(\s*scene: scene, reveal: model\.reveal[^)]*\)/);
    expect(buttonCall).not.toBeNull();
    expect(buttonCall![0]).not.toContain("rowActionsAskAbout");
  });

  it("지하철역 제목: 헤딩 trait 유지 + 밀기 버튼(왼쪽 상세 → 길찾기, 오른쪽 전화·끝까지 밀기 꺼짐, E72)", () => {
    const s = nearby("SubwayNearbyView.swift");
    expect(declaredInOrder(s, "stationHeading(station)\n", [".accessibilityAddTraits(.isHeader)", ".modifier(StationTitleActions("])).toBe(true);
    expect(declaredInOrder(s, "struct StationTitleActions", [
      ".swipeActions(edge: .trailing) {",
      'Button(appLocalized("transitGuide.openStation", name))',
      'Button(appLocalized("directions.toHere"))',
      ".swipeActions(edge: .leading, allowsFullSwipe: false) {",
      "Button(stationCallLabel(",
    ])).toBe(true);
    expect(s.slice(s.indexOf("struct StationTitleActions"))).not.toContain(".accessibilityActions");
    // 전화는 E45 창구 하나(라벨 `stationCallLabel`, 동작 `callStationPhone`)만 지난다 — 브리핑도 같은 라벨 함수.
    expect(s.slice(s.indexOf("struct StationTitleActions"))).toContain("callStationPhone(");
    expect(read("ios/Gildongmu/RouteBriefing.swift")).toContain("stationCallLabel(");
    // 노선 힌트는 Kit 순수 함수(테스트 레인 있음), 라벨 이름은 헤딩과 같은 언어 판정.
    expect(s).toContain("nearbyStationLineHint(lines: station.lines)");
    expect(s).toContain("subwayStationSpokenName(");
  });

  it("버스 정류소 제목: 헤딩 trait 유지 + 여기까지 길찾기 하나", () => {
    const s = nearby("BusNearbyView.swift");
    expect(declaredInOrder(s, "private func stopTitle(", [
      "busStopHeading(stop).accessibilityAddTraits(.isHeader)",
      "if directionsEntryAllowed {",
      "heading.swipeActions(edge: .trailing, allowsFullSwipe: false) {",
      'Button(appLocalized("directions.toHere"))',
    ])).toBe(true);
    expect(s).toContain("stopTitle(stop)");
  });

  it("앵커 목록의 길찾기 진입은 장소 상세의 showsDirectionsEntry를 따른다(안내 시트·길찾기 탭 스택 보호)", () => {
    const detail = read("ios/Gildongmu/PlaceDetailView.swift");
    expect(detail).toContain("SubwayNearbyView(anchor: anchor, directionsEntryAllowed: showsDirectionsEntry)");
    expect(detail).toContain("BusNearbyView(anchor: anchor, directionsEntryAllowed: showsDirectionsEntry)");
    expect(nearby("SubwayNearbyView.swift")).toMatch(/if directionsEntryAllowed \{\s*Button\(appLocalized\("directions\.toHere"\)\)/);
    // 로터가 여는 역 상세도 같은 값을 받는다.
    expect(nearby("SubwayNearbyView.swift")).toContain("showsDirectionsEntry: directionsEntryAllowed");
  });

  it("A64·A66: 상세를 push하는 목록 일곱은 push한 화면에서 돌아온 등장에 다시 조회하지 않는다(판정은 NearbyLoadCore 한 곳)", () => {
    // 화면은 등장을 코어의 appear()로 넘기고, push한 화면이 나타날 때 표식만 알린다. 화면별 건너뛰기 분기를 두지 않는다.
    const pushes: Record<string, number> = {
      "SubwayNearbyView.swift": 1, // 역 상세
      "BusNearbyView.swift": 1, // 노선 정류소
      "AroundNearbyView.swift": 3, // 한눈에 보기 상세 · 주변 가게 상세 · 주변 상황 행(onPushed)
      "KidsNearbyView.swift": 1, // 장소 상세(A66)
      "BarrierFreeNearbyView.swift": 1,
      "ClinicNearbyView.swift": 1,
      "EventsNearbyView.swift": 1,
    };
    for (const [file, n] of Object.entries(pushes)) {
      const s = nearby(file);
      expect(s, file).toContain(".task { await model.appear() }");
      expect(s, file).not.toContain(".task { await model.load() }");
      expect(s, file).not.toContain("skipReloadOnReturn");
      expect(s.split("model.notePushed()").length - 1, file).toBe(n);
    }
    // 장소 상세를 push하는 넷(A66)은 표식이 상세 화면에 붙는다 — 행 라벨·링크에 붙으면 목록이 그려질 때마다 표식이 서서
    // 탭 전환 복귀의 재조회까지 건너뛴다.
    for (const file of ["KidsNearbyView.swift", "BarrierFreeNearbyView.swift", "ClinicNearbyView.swift", "EventsNearbyView.swift"]) {
      expect(nearby(file), file).toMatch(/NavigationLink \{\s*PlaceDetailView\([^\n]*\)( \{[\s\S]*?\n {28}\})?\s*\.onAppear \{ model\.notePushed\(\) \}\s*\} label:/);
    }
    // 주변 상황 행의 상세도 표식을 낸다(자동 펼침 섹션이 부모 코어로 넘긴다).
    const scene = nearby("SurroundingsSceneSection.swift");
    expect(scene).toContain("PlaceDetailView(place: sceneItemToPlace(item))\n                        .onAppear { onPushed?() }");
    // 코어: 표식은 목록이 있을 때만, 등장은 표식 1회 소비 뒤 load(). 상태만으로 막지 않는다(탭 전환 복귀는 재조회).
    const core = read("ios/GildongmuKit/Sources/GildongmuKit/NearbyLoadCore.swift");
    expect(core).toMatch(/public func notePushed\(\) \{\s*if case \.loaded = phase \{ coveredByPush = true \}\s*\}/);
    expect(core).toMatch(/public func appear\(\) async \{\s*if coveredByPush \{\s*coveredByPush = false\s*if case \.loaded = phase \{ return \}\s*\}\s*await load\(\)\s*\}/);
  });

  it("목록의 길찾기 허용 인자는 기본값이 없다 — 새 호스트가 빠뜨리면 컴파일이 막는다", () => {
    for (const file of ["SubwayNearbyView.swift", "BusNearbyView.swift"]) {
      expect(nearby(file)).toContain("init(anchor: PlaceAnchor? = nil, directionsEntryAllowed: Bool) {");
    }
    const hub = read("ios/Gildongmu/NearbyHubView.swift");
    expect(hub).toContain("SubwayNearbyView(directionsEntryAllowed: true)");
    expect(hub).toContain("BusNearbyView(directionsEntryAllowed: true)");
  });
});
