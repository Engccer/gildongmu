import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTranslator } from "next-intl";
import { buildCatalog, TARGETS } from "../../../ios/scripts/messages-to-xcstrings.mjs";

type CatalogStrings = Record<
  string,
  { localizations: Record<string, { stringUnit: { value: string } }> }
>;

const root = resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("E43 버스 경유 정류소 통지", () => {
  it.each([
    ["ko", "경유 정류소 1곳", "경유 정류소 2곳"],
    ["en", "1 stop on this route", "2 stops on this route"],
    ["es", "1 parada en la ruta", "2 paradas en la ruta"],
    ["fr", "1 arrêt sur la ligne", "2 arrêts sur la ligne"],
    ["it", "1 fermata sulla linea", "2 fermate sulla linea"],
    ["ja", "経由停留所1か所", "経由停留所2か所"],
  ])("%s: 주변으로 오인하지 않고 단복수를 구분한다", (locale, one, other) => {
    const messages = JSON.parse(read(`ios/i18n/ios-extra/${locale}.json`));
    expect(messages.ios.nearby.announceRouteStops).toBeTypeOf("string");
    const t = createTranslator({ locale, messages });
    expect(t("ios.nearby.announceRouteStops", { count: 1 })).toBe(one);
    expect(t("ios.nearby.announceRouteStops", { count: 2 })).toBe(other);
  });

  it("생성 카탈로그에 count 첫 인자와 ICU 분기가 보존된다", () => {
    const { catalog } = buildCatalog(TARGETS.app);
    const entry = (catalog.strings as CatalogStrings)["ios.nearby.announceRouteStops"];
    expect(entry).toBeDefined();
    expect(entry.localizations.ko.stringUnit.value).toBe("경유 정류소 %1$@곳");
    expect(entry.localizations.en.stringUnit.value).toBe(
      "{1, plural, one {%1$@ stop on this route} other {%1$@ stops on this route}}",
    );
  });
});

// 앱 SwiftUI 테스트 레인이 없으므로 화면과 기존 판정기의 연결만 소스 가드로 잠근다.
// 실제 VoiceOver 노출·포커스·설정 복귀 갱신의 증거는 실기기에서 별도로 얻어야 한다.
describe("E43 iOS 화면 배선", () => {
  it("위치 오버레이가 서버 오류 카피를 기본값이나 override로 재사용하지 않는다", () => {
    const overlay = read("ios/Gildongmu/Nearby/NearbyOverlay.swift");
    expect(overlay).not.toMatch(/failedLocation: NearbyOverlayCopy = \.defaultFailure/);
    expect(overlay).toContain('appLocalized("manualLocation.gpsFailed")');
    const walk = read("ios/Gildongmu/Nearby/WalkInfraNearbyView.swift");
    expect(walk).not.toMatch(/failedLocation: NearbyOverlayCopy\(appLocalized\("ios.common.failedTitle"\)/);
  });

  it("경유 목록은 주변 통지 종류를 재사용하지 않고 0건도 경유 정보 부재로 알린다", () => {
    expect(read("ios/Gildongmu/Nearby/BusRouteStopsView.swift"))
      .toContain("nearbyLoadedNotice(count: stops.count, kind: .routeStops)");
    const source = read("ios/Gildongmu/Nearby/NearbyLoadState.swift");
    expect(source).toContain('case .routeStops: appLocalized("ios.nearby.announceRouteStops", count)');
    expect(source).toContain('appLocalized("ios.nearby.routeStopsEmpty")');
  });

  it.each(["PlaceDetailView.swift", "SearchView.swift"])("%s: URL이 생성된 경우에만 지도 액션을 만든다", (file) => {
    const source = read(`ios/Gildongmu/${file}`);
    for (const [builder, key] of [["Naver", "naver"], ["Kakao", "kakao"]]) {
      expect(source).toMatch(new RegExp(
        `if let url = build${builder}RouteDeeplink\\([^\\n]+\\) \\{\\s*Button\\(appLocalized\\("ios.route.${key}"\\)\\)`,
      ));
    }
    expect(source).toContain('appLocalized("directions.toHere")');
  });

  it("정확도 관찰 미러는 초기화와 권한 콜백에서 갱신되고 표시줄이 읽는다", () => {
    const service = read("ios/Gildongmu/LocationService.swift");
    expect(service).toMatch(/private\(set\) var observedAccuracy: CLAccuracyAuthorization/);
    expect(service).toContain("observedAccuracy = manager.accuracyAuthorization");
    expect(service).toContain("self.observedAccuracy = accuracy");
    const bar = read("ios/Gildongmu/LocationBarView.swift");
    expect(bar).toMatch(/case \.denied, \.restricted:\s*return appLocalized\("ios.common.geoDeniedTitle"\)/);
    expect(bar).toMatch(/location.observedAccuracy == \.reducedAccuracy/);
    expect(bar).toContain('appLocalized("ios.common.geoReducedTitle")');
    // 마지막 좌표가 있는 실패의 기존 계약: 실패 문구는 좌표 없는 분기 안에만 둔다.
    expect(bar).toMatch(/guard location.lastCoordinate != nil else \{\s*return appLocalized\(location.lastFixFailed/);
  });
});
