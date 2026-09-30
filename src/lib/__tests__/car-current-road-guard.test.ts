import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * iOS 자동차 안내 "현재 도로, {이름}" 행(E56 spec 2026-09-30)의 **배선**을 소스로 잠근다.
 * 앱 타깃은 테스트 레인이 없고, 값 판정(`roadNameAt`)은 Kit `CarRouteGuideTests`가 지킨다.
 * 웹 미러의 동작은 `useRouteGuide.car-road.test.tsx`·`DistanceBeacon-live-rows.test.tsx`.
 */
const read = (rel: string) =>
  readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");
const model = read("ios/Gildongmu/Directions/BeaconModel.swift");
const sheet = read("ios/Gildongmu/Directions/BeaconTrackingSheet.swift");

const fnBody = (src: string, signature: string) => {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`${signature}를 찾지 못했다 — 이름이 바뀌었는가`);
  return src.slice(start, src.indexOf("\n    }\n", start));
};

describe("iOS car 현재 도로 행 — 배선 (E56)", () => {
  it("행의 원천은 현재 진행거리의 링크 도로명이다 — 스텝 문장이 아니다", () => {
    // 한 안내 구간 안에서 도로가 바뀌는 스텝이 15%라 스텝 단위(유닛 전문·스텝 인덱스)로는 틀린 구간이
    // 생긴다(spec §2.2). 원천을 문장·스텝으로 되돌리면 이 단언이 깨진다.
    const body = fnBody(model, "private func refreshCurrentRoad(state: GuideState)");
    expect(body).toMatch(/roadNameAt\(spans: roadSpans, d: state\.d\)/);
    expect(body).toContain('appLocalized("guide.currentRoad", $0)');
    expect(body).not.toMatch(/GuideText\.unit|unitAt|stepIndex/);
    // 같은 이름이면 대입하지 않는다 — 행이 불변이라 VoiceOver가 다시 읽지 않는다.
    expect(body).toMatch(/if currentRoadText != text \{ currentRoadText = text \}/);
  });

  it("종전 구간 전문 행의 흔적이 없다", () => {
    expect(model).not.toMatch(/currentGuidanceText|refreshCurrentGuidance|func currentDisplay/);
    expect(sheet).not.toContain("currentGuidanceText");
  });

  it("시트 상세 분기에서 현재 도로 행이 하단 2행보다 앞이고 car·비이탈에서만 선다", () => {
    const road = sheet.indexOf("let road = model.currentRoadText");
    const top = sheet.indexOf("if let top = model.liveTopText");
    expect(road).toBeGreaterThan(-1);
    expect(top).toBeGreaterThan(road);
    const guard = sheet.slice(sheet.lastIndexOf("if ", road), road);
    expect(guard).toMatch(/model\.sessionKind == \.car, !model\.offRoute/);
    // 행 렌더는 한 자리뿐이다(간략 분기의 도달 불가 사본을 지웠다).
    expect(sheet.match(/model\.currentRoadText/g)).toHaveLength(1);
  });

  it("전경 복귀 재생의 car 폴백은 지금 할 일이 먼저다 — 도로 이름은 그다음", () => {
    // 상태 행이 비어 있으면(실행 안내 직후) "현재 상태"로 갚는 문장이다. 도로 이름만 갚으면 놓친 행동이
    // 사라지고, 무명 링크 위 복귀는 빈 문자열이라 통지 없이 장부만 소비된다(E56 설계 리뷰 M2).
    expect(model).toMatch(
      /let carState = sessionKind == \.car \? \(liveTopText \?\? currentRoadText\) : nil\n\s*let current = statusText\.isEmpty \? \(carState \?\? ""\) : statusText/,
    );
  });
});
