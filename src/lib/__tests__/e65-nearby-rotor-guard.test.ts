import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// E65 내 주변 로터 액션의 iOS 배선 가드(spec 2026-10-05-nearby-rotor-actions-design.md §2·§3).
// 뷰 계층은 테스트 레인이 없어 소스로 잠근다. 로터는 빌더 선언의 역순으로 들리므로 순서는 선언 위치로 본다.

const root = resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const nearby = (file: string) => read(`ios/Gildongmu/Nearby/${file}`);

/** `start` 뒤에서 각 needle이 처음 나오는 위치가 주어진 순서대로 증가하는가. */
function declaredInOrder(source: string, start: number, needles: string[]): boolean {
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
    // 버튼형 호출은 rowActionsAskAbout을 넘기지 않는다(기본값 nil).
    const buttonCall = s.slice(s.indexOf("SurroundingsSceneGroupsView(\n                scene: scene, reveal: model.reveal"));
    expect(buttonCall.slice(0, buttonCall.indexOf(")") + 1)).not.toContain("rowActionsAskAbout");
  });

  it("PlaceRow 묶음은 수정자 하나다 — 검색 결과 행과 주변 상황 행이 같은 선언을 지난다", () => {
    const s = read("ios/Gildongmu/SearchView.swift");
    const row = s.slice(s.indexOf("struct PlaceRow: View"), s.indexOf("struct PlaceRowActions"));
    expect(row).toContain(".placeRowActions(place, onAskAbout: onAskAbout)");
    expect(row).not.toContain(".accessibilityActions");
  });

  it("지하철역 제목: 헤딩 trait 유지 + 전화·길찾기·상세 역순 선언(들리는 순서는 상세 → 길찾기 → 전화)", () => {
    const s = nearby("SubwayNearbyView.swift");
    const heading = s.indexOf("stationHeading(station)");
    expect(declaredInOrder(s, heading, [".accessibilityAddTraits(.isHeader)", ".modifier(StationTitleActions("])).toBe(true);
    const actions = s.indexOf("struct StationTitleActions");
    expect(declaredInOrder(s, actions, [
      "Button(callLabel(",
      'Button(appLocalized("directions.toHere"))',
      'Button(appLocalized("transitGuide.openStation", name))',
    ])).toBe(true);
    // 전화는 E45 창구 하나만 지난다.
    expect(s.slice(actions)).toContain("callStationPhone(");
  });

  it("버스 정류소 제목: 헤딩 trait 유지 + 여기까지 길찾기 하나", () => {
    const s = nearby("BusNearbyView.swift");
    const heading = s.indexOf("busStopHeading(stop)");
    expect(declaredInOrder(s, heading, [
      ".accessibilityAddTraits(.isHeader)",
      ".accessibilityActions {",
      'Button(appLocalized("directions.toHere"))',
    ])).toBe(true);
  });

  it("앵커 목록의 길찾기 진입은 장소 상세의 showsDirectionsEntry를 따른다(안내 시트·길찾기 탭 스택 보호)", () => {
    expect(read("ios/Gildongmu/PlaceDetailView.swift")).toContain(
      ".environment(\\.directionsEntryAllowed, showsDirectionsEntry)",
    );
    for (const file of ["SubwayNearbyView.swift", "BusNearbyView.swift"]) {
      expect(nearby(file)).toMatch(/if directionsEntryAllowed \{\s*Button\(appLocalized\("directions\.toHere"\)\)/);
    }
    // 로터가 여는 역 상세도 같은 값을 받는다.
    expect(nearby("SubwayNearbyView.swift")).toContain("showsDirectionsEntry: directionsEntryAllowed");
  });
});
