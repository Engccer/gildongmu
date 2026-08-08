import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 안내 경로가 수동 위치를 절대 보지 않는다는 소스 가드.
 *
 * ⚠ 이 가드는 타입 봉인의 **보조**다. 정본은 `awaitRealFix`가 `RealFix`를
 * 반환하고 안내 함수들이 그 타입만 받는 것이며, 이 테스트는 실수로
 * `awaitEffectiveLocation`을 import 하는 것을 커밋 시점에 잡는다.
 */
describe("useRouteGuide — 실좌표 봉인", () => {
  const src = readFileSync("src/hooks/useRouteGuide.ts", "utf8");

  it("awaitEffectiveLocation을 import 하지 않는다", () => {
    expect(src).not.toMatch(/awaitEffectiveLocation/);
  });

  it("awaitRealFix를 쓴다", () => {
    expect(src).toMatch(/awaitRealFix/);
  });

  it("manual-location-store를 참조하지 않는다", () => {
    expect(src).not.toMatch(/manual-location-store/);
  });
});
