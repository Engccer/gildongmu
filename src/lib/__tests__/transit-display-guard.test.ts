import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRANSIT_TEXT_KEYS } from "../transit-guide-text";

/**
 * 표시/조인 분리의 **2선**(E27 잔여 ①, spec 2026-09-01 §5.2·§5.3).
 *
 * 1선은 구조다 — 문장 계층은 조인 필드가 타입에 없는 투영만 받는다. 이 파일은 그 구조를
 * 우회하는 경로(원본 leg·item에서 이름을 직접 읽어 화면에 꽂기)를 소스에서 막고, 게이트가
 * **개수가 아니라 조건**으로 유지되는지 본다(자리 수만 세면 같은 자리에 조건이 되돌아와도
 * 통과한다 — 설계 리뷰 #17).
 *
 * Swift 소스를 웹 테스트가 읽는 선례: `guidance-gate-drift.test.ts`·`place-hours-tts-drift.test.ts`.
 */
const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** 조인 필드 — 조회 쿼리·매핑표·종착 검사가 이 값으로 돈다(en 세션에서도 한국어 원문). */
const JOIN_FIELDS = [
  "lineName",
  "boardName",
  "alightName",
  "destinationName",
  "\\.direction",
  "stop.name",
];

/**
 * 문구를 만드는 호출 — 여기에 조인 값이 들어가는 것이 정확한 실패 모드다.
 *
 * ⚠ 술어를 "조인 필드가 파일에 등장하는가"로 넓히면 정당한 조인 자리(URL 조립·잠금 routeId)가
 * 전부 걸려 allowlist가 커지고, 커진 allowlist는 다음 위반을 숨긴다. 좁은 술어가 낫다.
 */
const RENDER_CALLS = /(appLocalized\(|\bt\(|Text\(|joinText\(|render\()/;

function offendingLines(file: string): string[] {
  return read(file)
    .split("\n")
    .map((l, i) => ({ l, i }))
    .filter(
      ({ l }) =>
        RENDER_CALLS.test(l) && JOIN_FIELDS.some((f) => new RegExp(`\\b${f}\\b`).test(l)),
    )
    .map(({ l, i }) => `${file}:${i + 1} ${l.trim()}`);
}

describe("조인 값이 문구 조회에 들어가지 않는다 (2선 = 소스 가드)", () => {
  it("웹 훅·패널", () => {
    expect(offendingLines("src/hooks/useTransitGuide.ts")).toEqual([]);
    expect(offendingLines("src/components/TransitGuidePanel.tsx")).toEqual([]);
  });

  it("iOS 모델·시트·조망", () => {
    expect(offendingLines("ios/Gildongmu/Directions/TransitGuideModel.swift")).toEqual([]);
    expect(offendingLines("ios/Gildongmu/Directions/TransitTrackingSheet.swift")).toEqual([]);
    expect(offendingLines("ios/Gildongmu/Directions/GuideOverviewSheet.swift")).toEqual([]);
  });

  it("iOS 승차 전 도보 자리 — 역명이 문구 조회에 원문으로 들어가지 않는다", () => {
    // 웹만 배선하고 iOS 네 자리를 빠뜨렸던 자리(시작 통지·선언 버튼·확정/추정 도착 문장).
    // `prewalkTarget`이 이제 ko·en 쌍이라 `appLocalized(..., station)` 형태면 컴파일이 막지만,
    // 새 문자열 자리가 생겼을 때를 위해 소스에서도 본다.
    for (const file of [
      "ios/Gildongmu/Directions/BeaconModel.swift",
      "ios/Gildongmu/Directions/GuideSessionCoordinator.swift",
      "ios/Gildongmu/Directions/BeaconTrackingSheet.swift",
    ]) {
      const hits = read(file)
        .split("\n")
        .map((l, i) => ({ l, i }))
        // **역명을 인자로 받는 키만** 본다 — `prewalkUnavailable`·`prewalkCancelled`는 인자가
        // 없는 순수 UI 문구라 언어 선택 축이 아니다(넓게 잡으면 잡음이 allowlist를 키운다).
        .filter(({ l }) =>
          /appLocalized\("transitGuide\.(prewalkStart|prewalkArrived|prewalkArrivedButton)"/.test(l),
        )
        .map(({ l, i }) => `${file}:${i + 1} ${l.trim()}`);
      // 이 키들은 전부 descriptor(`transitPrewalk*Line`)를 지나야 한다.
      expect(hits).toEqual([]);
    }
  });
});

describe("iOS 리터럴 switch 망라성 (앱 타깃엔 테스트 레인이 없다)", () => {
  it("descriptor가 낼 수 있는 모든 키가 렌더러에 리터럴 case로 있다", () => {
    const src = read("ios/Gildongmu/Directions/TransitGuideTextRenderer.swift");
    for (const key of TRANSIT_TEXT_KEYS) {
      expect(src, key).toContain(`case "${key}": return appLocalized("transitGuide.${key}"`);
    }
  });

  it("Kit 키 목록이 웹과 같다", () => {
    const swift = read("ios/GildongmuKit/Sources/GildongmuKit/TransitGuideText.swift");
    const listed = swift
      .slice(swift.indexOf("public let transitTextKeys"))
      .match(/"([a-zA-Z]+)"/g)!
      .map((s) => s.slice(1, -1));
    expect([...listed].sort()).toEqual([...TRANSIT_TEXT_KEYS].sort());
  });
});

describe("대중교통 안내 시작 게이트 (조건으로 본다, 개수로 세지 않는다)", () => {
  it("웹 두 자리에 로케일 조건이 없다", () => {
    const src = read("src/components/DirectionsView.tsx");
    expect(src).toContain("startable: buildTransitGuideRoute(route) !== null,");
    expect(src).toContain("const guideStartable = buildTransitGuideRoute(route) !== null;");
  });

  it("iOS 두 자리에 로케일 조건이 없고 실험 플래그가 있다", () => {
    const src = read("ios/Gildongmu/Directions/DirectionsTabView.swift");
    const startable = src.slice(
      src.indexOf("private var transitGuideStartable"),
      src.indexOf("/// 대안 경로 시작 게이트"),
    );
    expect(startable).toContain("AppConfig.experimentalGuidanceEnabled");
    expect(startable).not.toContain('AppLanguage.dataLocale == "ko"');

    const alt = src.slice(
      src.indexOf("private func altTransitGuideStartable"),
      src.indexOf("/// 간략 폴백 게이트"),
    );
    expect(alt).toContain("AppConfig.experimentalGuidanceEnabled");
    expect(alt).not.toContain('AppLanguage.dataLocale == "ko"');
  });

  it("다른 축의 게이트는 **여전히 있다**(같이 지워지지 않았음을 증명)", () => {
    // 반대 방향 단언 — 계단 회피·자동차·도보는 이 마일스톤의 대상이 아니다.
    const web = read("src/components/DirectionsView.tsx");
    expect(web).toContain("const stepFreeSupported = !prefersEnglish(locale)");
    const ios = read("ios/Gildongmu/Directions/DirectionsTabView.swift");
    const car = ios.slice(
      ios.indexOf("private var carGuideStartable"),
      ios.indexOf("private var transitGuideStartable"),
    );
    expect(car).toContain('AppLanguage.dataLocale == "ko"');
    // 계단 회피 토글의 무력화(비-ko에서 값 자체를 끈다)도 그대로.
    expect(ios).toContain('let accessible = stepFreeEnabled && AppLanguage.dataLocale == "ko"');
  });
});
