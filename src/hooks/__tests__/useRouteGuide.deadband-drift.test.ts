import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 상세 모드 데드밴드 상수의 웹↔Kit 드리프트 가드(`guide-motion-drift.test.ts` 선례).
 *
 * 이 값은 "가까워지는 중" 톤이 얼마나 자주 나는가를 혼자 정한다 — closer 최소 간격
 * (도보 2초)은 상한일 뿐이고 실질 간격은 잔여 거리가 이만큼 줄어드는 시간이기 때문이다.
 * 한쪽만 바뀌면 같은 보행에서 플랫폼마다 톤 빈도가 갈리는데, **더 조용해진 쪽은
 * 고장과 구분되지 않는다**(백그라운드에서는 톤이 유일한 채널이다).
 *
 * 간략 비콘의 `BASE_DEAD_BAND_M`(15)과 합치려는 회귀도 함께 막는다. 두 값이 갈린 것은
 * 축이 다르기 때문이다 — 간략은 직선거리라 GPS 지터가 그대로 실리지만, 상세의 잔여
 * 거리는 구속 창 투영 + 단조 전진을 거치고 이탈·튐 fix는 앞 단계가 버린다.
 */
const WEB = path.resolve(__dirname, "../useRouteGuide.ts");
const KIT = path.resolve(__dirname, "../../../ios/Gildongmu/Directions/BeaconModel.swift");

/** 웹 상수 이름 → Swift `BeaconModel` 프로퍼티 이름. */
const PAIRS: [string, string][] = [
  ["DETAIL_DEAD_BAND_M", "detailDeadBand"],
  ["DETAIL_DEAD_BAND_FLOOR_M", "detailDeadBandFloor"],
];

function webConst(src: string, name: string): number {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*(-?[0-9.]+)`));
  expect(m, `웹에 ${name} 선언이 없다`).not.toBeNull();
  return Number(m![1]);
}

function swiftConst(src: string, name: string): number {
  const m = src.match(new RegExp(`static let ${name}\\s*=\\s*(-?[0-9.]+)`));
  expect(m, `Swift에 ${name} 선언이 없다`).not.toBeNull();
  return Number(m![1]);
}

describe("상세 데드밴드 웹↔Kit 동조", () => {
  const web = readFileSync(WEB, "utf8");
  const swift = readFileSync(KIT, "utf8");

  for (const [webName, swiftName] of PAIRS) {
    it(`${webName} = ${swiftName}`, () => {
      expect(swiftConst(swift, swiftName)).toBe(webConst(web, webName));
    });
  }

  it("감쇠 하한이 데드밴드보다 작다(같으면 감쇠가 죽는다)", () => {
    expect(webConst(web, "DETAIL_DEAD_BAND_FLOOR_M")).toBeLessThan(
      webConst(web, "DETAIL_DEAD_BAND_M"),
    );
  });

  it("상세 추세 축이 간략 데드밴드를 쓰지 않는다", () => {
    // 간략 경로의 `Math.max(BASE_DEAD_BAND_M, fix.accuracy)`는 그대로 두고,
    // 정확도로 스케일하지 않는 상세 조립부만 본다.
    expect(web).not.toMatch(/deadBand:\s*BASE_DEAD_BAND_M\s*,/);
    expect(swift).not.toMatch(/deadBand:\s*BeaconConstants\.baseDeadBand\s*,\s*\n\s*\/\//);
  });
});
