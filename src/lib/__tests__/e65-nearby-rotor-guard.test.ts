import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// E65 내 주변 로터 액션의 iOS 배선 가드(spec 2026-10-05-nearby-rotor-actions-design.md §2·§3).
// 뷰 계층은 테스트 레인이 없어 소스로 잠근다. 로터는 빌더 선언의 역순으로 들리므로 순서는 선언 위치로 본다.

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
    expect(s).toContain("ForEach(overviewDetailTargets(bullet, lang: lang).reversed())");
    expect(s).toContain('appLocalized("transitGuide.openStation", target.name)');
    expect(s).toContain('appLocalized("ios.chat.openPlace", target.name)');
    // 행사는 목록 화면과 같은 상세(행사 섹션 포함).
    expect(s).toMatch(/PlaceDetailView\(place: target\.place, stationLineHint: target\.lineHint\) \{\s*if let event = target\.event \{ CultureEventSection\(event: event\) \}/);
  });

  it("주변 상황: 둘러보기(자동 펼침)만 PlaceRow 묶음을 단다 — 버튼형(안내 시트)은 붙이지 않는다", () => {
    const s = nearby("SurroundingsSceneSection.swift");
    expect(s).toContain(".placeRowActions(place, onAskAbout: { rowActionsAskAbout(place) })");
    expect(s).toContain("rowActionsAskAbout: onAskAbout)");
    // 버튼형 호출은 rowActionsAskAbout을 넘기지 않는다(기본값 nil). 호출 전체를 공백 무관으로 잡는다.
    const buttonCall = s.match(/SurroundingsSceneGroupsView\(\s*scene: scene, reveal: model\.reveal[^)]*\)/);
    expect(buttonCall).not.toBeNull();
    expect(buttonCall![0]).not.toContain("rowActionsAskAbout");
  });

  it("PlaceRow 묶음은 수정자 하나다 — 검색 결과 행과 주변 상황 행이 같은 선언을 지난다", () => {
    const s = read("ios/Gildongmu/SearchView.swift");
    const row = s.slice(s.indexOf("struct PlaceRow: View"), s.indexOf("struct PlaceRowActions"));
    expect(row).toContain(".placeRowActions(place, onAskAbout: onAskAbout)");
    expect(row).not.toContain(".accessibilityActions");
  });

  it("지하철역 제목: 헤딩 trait 유지 + 전화·길찾기·상세 역순 선언(들리는 순서는 상세 → 길찾기 → 전화)", () => {
    const s = nearby("SubwayNearbyView.swift");
    expect(declaredInOrder(s, "stationHeading(station)\n", [".accessibilityAddTraits(.isHeader)", ".modifier(StationTitleActions("])).toBe(true);
    expect(declaredInOrder(s, "struct StationTitleActions", [
      "Button(stationCallLabel(",
      'Button(appLocalized("directions.toHere"))',
      'Button(appLocalized("transitGuide.openStation", name))',
    ])).toBe(true);
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
      "heading.accessibilityActions {",
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

  it("지하철 목록: 로터로 연 상세에서 돌아온 한 번만 재조회를 건너뛰고, 탭 전환 복귀는 종전대로 재조회한다", () => {
    const s = nearby("SubwayNearbyView.swift");
    expect(s).toContain("onOpen: { skipReloadOnReturn = true; stationDetail = $0 }");
    expect(s).toMatch(
      /\.task \{\s*if skipReloadOnReturn \{\s*skipReloadOnReturn = false\s*return\s*\}\s*await model\.load\(\)\s*\}/,
    );
    // 상태로 막는 게이트(탭 전환 복귀까지 막는다)를 되살리지 않는다.
    expect(s).not.toMatch(/if case \.loaded = model\.phase \{ return \}/);
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
