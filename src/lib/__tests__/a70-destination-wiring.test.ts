import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A70(spec 2026-10-19 §4.1·§2) 배선 소스 가드. 리듀서의 이탈 중 도착 창 입구는 `GuideRoute.destination`이 있어야 열린다 —
 * 선택 필드라 오케스트레이터가 빠뜨려도 컴파일이 통과하고 입구가 조용히 닫힌다(46개 호출부를 기본값 없는 인자로 바꾸는 1선 대신
 * 안내 세션 세 자리만 2선으로 센다). 같은 이유로 자동 재조회의 첫 점 검사와 `nearDestination` 소비 자리도 센다.
 */
const root = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** `buildGuideRoute(` 호출 하나의 괄호 안(중첩 괄호 포함). */
function buildCalls(src: string): string[] {
  const out: string[] = [];
  let i = src.indexOf("buildGuideRoute(");
  while (i !== -1) {
    let depth = 0;
    let j = i + "buildGuideRoute".length;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf("buildGuideRoute(", j);
  }
  return out;
}

const ORCHESTRATORS = [
  { name: "웹 useRouteGuide", path: "src/hooks/useRouteGuide.ts" },
  { name: "iOS BeaconModel", path: "ios/Gildongmu/Directions/BeaconModel.swift" },
  { name: "안드로이드 WalkGuideModel", path: "android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/WalkGuideModel.kt" },
];

describe("A70 배선 가드", () => {
  for (const o of ORCHESTRATORS) {
    it(`${o.name}: 안내 경로 조립이 목적지를 싣는다`, () => {
      const calls = buildCalls(read(o.path));
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c, c).toMatch(/destination/);
    });

    it(`${o.name}: 자동 재조회가 새 경로 첫 점을 검사하고, 이탈 중 도착 창 이벤트를 소비한다`, () => {
      const src = read(o.path);
      expect(src).toMatch(/routeStartsNearby/);
      expect(src).toMatch(/nearDestination|NearDestination/);
      expect(src).toMatch(/routeStartsAway/);
    });
  }
});
