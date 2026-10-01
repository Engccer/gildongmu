import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A53 ① iOS: 대중교통 안내 세션이 목적지 라틴 표기를 들고, 조망 "다른 경로"의 영어 도보 줄이 그것을 쓴다.
// 판정(라틴이면 그 이름, 아니면 "목적지까지")은 Kit `TransitWalkLegText.destinationName`이 정본이고 여기선 배선만 잠근다.
const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const DIR = "ios/Gildongmu/Directions";

describe("대중교통 안내 목적지 라틴 표기 운반(A53 ①)", () => {
  it("모델은 라벨을 바꾸는 모든 자리에서 라틴 표기도 함께 바꾼다", () => {
    const model = read(`${DIR}/TransitGuideModel.swift`);
    const labelSets = model.match(/self\.destinationLabel = destinationLabel\n\s*self\.destinationRoman = destinationRoman\n/g) ?? [];
    expect(labelSets.length).toBe((model.match(/self\.destinationLabel = /g) ?? []).length);
    expect(labelSets.length).toBeGreaterThanOrEqual(2);
    // 경로 교체는 같은 목적지라 표기를 잇고, 목적지 전환은 새 목적지의 표기를 쓴다.
    expect(model).toContain("destinationRoman: destinationRoman, dest: dest,\n                          announcement: .routeSwitched");
    expect(model).toContain("destinationRoman: pending.labelRoman, dest: pending.dest");
  });

  it("시작 경로는 길찾기 화면의 브리핑과 같은 표기를 넘기고, 승차 전 도보 뒤에도 잇는다", () => {
    expect(read(`${DIR}/DirectionsTabView.swift`)).toMatch(
      /session\.startTransit\([\s\S]{0,300}destinationRoman: destinationPlaceRoman,/,
    );
    const coordinator = read(`${DIR}/GuideSessionCoordinator.swift`);
    expect(coordinator.match(/destinationRoman: context\.destinationRoman,/g)?.length).toBe(2);
  });

  it("목적지 전환 진입 둘은 고른 장소의 표기를 넘긴다", () => {
    expect(read(`${DIR}/TransitTrackingSheet.swift`)).toContain("label: label, labelRoman: roman)");
    expect(read("ios/Gildongmu/PlaceDetailView.swift")).toContain("label: place.name, labelRoman: place.nameRoman)");
  });

  it("장소에서 만드는 끝점은 라틴 표기를 싣는다(검색 결과 로터·장소 상세 — 버리면 en 도보 줄이 늘 목적지까지다)", () => {
    for (const file of ["ios/Gildongmu/SearchView.swift", "ios/Gildongmu/PlaceDetailView.swift"]) {
      const source = read(file);
      expect(source).toContain("labelRoman: place.nameRoman)");
      expect(source).not.toMatch(/\.place\(label: place\.name, lat: place\.lat, lng: place\.lng\)/);
    }
  });

  it("조망 다른 경로 목록은 세션의 표기를 쓴다", () => {
    const sheet = read(`${DIR}/GuideOverviewSheet.swift`);
    expect(sheet).toContain("destinationName: model.destinationLabel, destinationRoman: model.destinationRoman)");
    expect(sheet).not.toContain("destinationRoman: nil");
  });
});

// A53 iOS 잔여: 시작 통지·목적지 변경 통지도 조망 도보 줄과 같은 판정으로 목적지 이름을 고른다 — en(데이터 언어)이면 라틴
// 표기, 없으면 이름 없는 문구. 한글 라벨이 영어 문장에 섞이지 않는다(E27 한 줄 한 언어).
describe("대중교통 안내 통지의 목적지 이름(A53 iOS 잔여)", () => {
  const model = read(`${DIR}/TransitGuideModel.swift`);

  it("통지용 이름은 Kit 판정 하나를 지난다", () => {
    expect(model).toMatch(
      /TransitWalkLegText\.destinationName\(\s*label: destinationLabel, roman: destinationRoman, english: transitGuideIsEn\)/,
    );
  });

  it("시작 통지: 이름이 있으면 startedAt, 없으면 이름 없는 started", () => {
    expect(model).not.toContain('appLocalized("transitGuide.startedAt", destinationLabel');
    expect(model).toMatch(
      /spokenDestinationName\.map \{ appLocalized\("transitGuide\.startedAt", \$0, guideRoute\.legs\.count\) \}\s*\?\? appLocalized\("transitGuide\.started", guideRoute\.legs\.count\)/,
    );
  });

  it("목적지 변경 통지: 이름이 있으면 destChanged, 없으면 이름 없는 문구", () => {
    expect(model).not.toContain('appLocalized("ios.guide.destChanged", destinationLabel)');
    expect(model).toMatch(
      /case \.destinationChanged:\s*spokenDestinationName\.map \{ appLocalized\("ios\.guide\.destChanged", \$0\) \}\s*\?\? appLocalized\("ios\.guide\.destChangedNoName"\)/,
    );
  });

  it("이름 없는 목적지 변경 문구는 6로케일에 있고 자리표시자가 없다", () => {
    for (const locale of ["ko", "en", "es", "fr", "it", "ja"]) {
      const value: string = JSON.parse(read(`ios/i18n/ios-extra/${locale}.json`)).ios.guide.destChangedNoName;
      expect(value, locale).toBeTruthy();
      expect(value, locale).not.toContain("{");
    }
  });
});
