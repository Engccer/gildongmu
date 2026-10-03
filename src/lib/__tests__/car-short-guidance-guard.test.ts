import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 자동차 짧은 안내(E61)의 앱 층 배선 소스 가드. iOS 앱 타깃은 테스트 레인이 없고, 웹 훅의
 * 이벤트 분기도 순수 함수 밖이라 아래 셋을 되돌려도 다른 테스트가 초록으로 통과한다.
 * ① 운전자 예고는 종전 문장 키(`guide.carDriverNotice`) — 새 주기 문장 키를 쓰면 운전자에게
 *   "147m 직진하다가 우회전"이 나간다(spec §3 "운전자 모드는 종전 문장").
 * ② `carStart`의 위치 인자는 ko 문장 순서(목적지 → 첫 안내 → 개수 → 거리) — arg-order 게이트는
 *   문자열만 보므로 호출부를 옛 순서로 되돌려도 통과한다.
 * ③ 임박 문장의 지점·방면은 행동이 있는 그 결정 지점 스텝(`indices`의 첫 값)의 것 — 다른 스텝을
 *   읽으면 이미 지난 교차로 이름을 말한다.
 */
const root = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const guideText = read("ios/Gildongmu/Directions/GuideText.swift");
const beacon = read("ios/Gildongmu/Directions/BeaconModel.swift");
const hook = read("src/hooks/useRouteGuide.ts");

function body(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, signature).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\n    static func ", start + signature.length);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("iOS GuideText 자동차 문장 배선", () => {
  it("① driverNotice는 guide.carDriverNotice만 쓴다", () => {
    const b = body(guideText, "static func driverNotice(");
    expect(b).toContain('"guide.carDriverNotice"');
    expect(b).not.toContain('"guide.carPeriodic');
  });

  it("② carStart 위치 인자는 목적지 → 첫 안내 → 개수 → 거리", () => {
    const b = body(guideText, "static func carStart(");
    expect(b).toMatch(
      /"guide\.carStart",\s*destination,\s*unit\(route: route, indices: firstIndices\),\s*route\.steps\.count,\s*formatDistance\(/,
    );
  });

  it("periodicCar는 다음 스텝의 지점만 싣는다(방면 없음)", () => {
    const b = body(guideText, "static func periodicCar(");
    expect(b).toContain("route.steps[stepIndex + 1]");
    expect(b).toContain('"guide.carPeriodicAt"');
    expect(b).not.toContain("toward");
  });
});

describe("임박 문장의 지점은 결정 지점 스텝의 것", () => {
  it("③ iOS BeaconModel: imminent 분기가 indices.first 스텝의 carLandmark를 넘긴다", () => {
    const start = beacon.indexOf("case let .imminent(indices, action, stage):");
    expect(start).toBeGreaterThanOrEqual(0);
    const branch = beacon.slice(start, beacon.indexOf("case let .farNotice", start));
    expect(branch).toMatch(/GuideText\.carImminentText\(\s*action, landmark: indices\.first\.flatMap \{ route\.steps\.indices\.contains\(\$0\) \? route\.steps\[\$0\]\.carLandmark : nil \}\)/);
  });

  it("③ 웹 useRouteGuide: imminent 분기가 event.indices[0] 스텝의 carLandmark를 넘긴다", () => {
    expect(hook).toContain("carImminentLine(event.action, route.steps[event.indices[0]]?.carLandmark, t, prefersEnglish(locale))");
  });
});
