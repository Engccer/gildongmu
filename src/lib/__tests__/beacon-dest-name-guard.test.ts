import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A55 소스 가드: en 도보·자동차 세션의 목적지 전환 통지와 시작 문장이 한글 원명을 싣지 않는다. 이름 판정은 Kit
 * `TransitWalkLegText.destinationName`(공유 fixture `transit-walk-destination-cases.json`)이 잠그고, 여기는 컴파일러가 못
 * 잡는 배선을 잠근다: 통지가 라벨을 직접 넣지 않고 같은 판정(`spokenDestinationName`)을 지나며, 라틴 표기를 운반하는 인자에
 * 기본값이 없다(빠뜨리면 조용히 원명으로 돌아간다).
 */
const DIR = join(__dirname, "../../../ios/Gildongmu/Directions");
const beacon = readFileSync(join(DIR, "BeaconModel.swift"), "utf8");

describe("도보 목적지 이름은 통지 언어로 판정한다(A55)", () => {
  it("목적지 전환 통지는 라벨을 직접 넣지 않고 spokenDestinationName·이름 없는 문구를 지난다", () => {
    expect(beacon).not.toMatch(/appLocalized\("ios\.guide\.destChanged",\s*label\)/);
    expect(beacon).toMatch(/spokenDestinationName\.map \{ appLocalized\("ios\.guide\.destChanged", \$0\) \}/);
    expect(beacon).toContain('appLocalized("ios.guide.destChangedNoName")');
  });

  it("판정은 대중교통과 같은 함수다", () => {
    expect(beacon).toMatch(
      /TransitWalkLegText\.destinationName\(label: destinationLabel, roman: destinationRoman, english: transitGuideIsEn\)/,
    );
  });

  it("시작 문장은 라벨이 아니라 spokenDestinationName을 받는다", () => {
    expect(beacon).not.toMatch(/GuideText\.(start|carStart)\([^)]*destination: destinationLabel\)/);
  });

  it("라틴 표기 운반 인자에 기본값이 없다", () => {
    expect(beacon).toMatch(/let labelRoman: String\?\n/);
    expect(beacon).toMatch(/func changeDestination\(dest newDest: BeaconDest, label: String, labelRoman: String\?\)/);
  });
});
