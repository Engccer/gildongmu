import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { orderDirectionsModes, type DirectionsModeKey } from "../directions-order";
import scenarios from "./fixtures/directions-order-scenarios.json";

type OrderCase = {
  name: string;
  modes: DirectionsModeKey[];
  success: Partial<Record<DirectionsModeKey, boolean>>;
  walkDurationSeconds: number | null;
  transitMinutes: number | null;
  expect: DirectionsModeKey[];
};

describe("orderDirectionsModes (공유 fixture — Kit 미러 동조)", () => {
  const cases = scenarios.order as OrderCase[];
  // 공회전 방지: fixture가 비면 아래 루프가 0회 돌고 조용히 통과한다(Kit 테스트와 같은 가드).
  it("fixture에 경계 케이스가 있다", () => {
    expect(cases.length).toBeGreaterThanOrEqual(18);
    // 키 누락 검출: Swift 디코더는 없는 키를 nil로 받아 조용히 통과한다(세 벌이 같은 파일을 읽으니 여기서 잠근다).
    for (const c of cases) {
      expect(Object.keys(c)).toEqual(expect.arrayContaining(["walkDurationSeconds", "transitMinutes"]));
    }
  });
  for (const c of cases) {
    it(c.name, () => {
      expect(orderDirectionsModes(c.modes, c.success, c.walkDurationSeconds, c.transitMinutes)).toEqual(c.expect);
    });
  }
  it("입력 배열을 변경하지 않는다", () => {
    const modes: DirectionsModeKey[] = ["transit", "car", "walk"];
    orderDirectionsModes(modes, { walk: true, transit: true }, 600, 20);
    expect(modes).toEqual(["transit", "car", "walk"]);
  });
});

// 순서는 조회 settled 시점 1회만 정한다(spec §2 규칙 3, E64 재확인): 계단 회피 토글·대중교통 수단 재조회는
// 결과를 부분 교체하고 순서 스냅샷을 그대로 둔다. 판정 호출이 둘이 되면 재조회 경로가 순서를 다시 매길
// 수 있으므로, 세 플랫폼의 판정 호출 자리를 하나로 잠근다.
describe("섹션 순서 판정 호출은 플랫폼마다 한 자리", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const countIn = (paths: string[], needle: RegExp) =>
    paths.reduce((n, p) => n + (read(p).match(needle) ?? []).length, 0);
  const filesUnder = (dir: string, ext: string): string[] =>
    readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && e.name.endsWith(ext))
      .map((e) => join(e.parentPath, e.name));
  it("웹: 판정 함수는 DirectionsView 한 자리에서만 부른다", () => {
    const callers = filesUnder("src", ".tsx")
      .concat(filesUnder("src", ".ts"))
      .filter((p) => !p.includes("__tests__") && !p.endsWith("directions-order.ts"));
    expect(countIn(callers, /orderDirectionsModes\(/g)).toBe(1);
    expect(countIn(["src/components/DirectionsView.tsx"], /orderDirectionsModes\(/g)).toBe(1);
  });
  it("Kit·:kit은 DirectionsResults 생성 때만 판정한다", () => {
    expect(countIn(["ios/GildongmuKit/Sources/GildongmuKit/Directions.swift"], /DirectionsOrder\.orderModes\(/g)).toBe(1);
    expect(countIn(["android/kit/src/main/kotlin/space/dodoplanet/gildongmu/kit/Directions.kt"], /DirectionsOrder\.orderModes\(/g)).toBe(1);
  });
  // 결과를 새로 만드는 자리(=순서를 다시 매기는 자리)는 앱 전체에서 조회 완료 하나뿐이다.
  // `DirectionsResults(` 와 `.init(outcomes:` 두 형태를 앱 소스 전체에서 센다.
  it("iOS·안드로이드 앱은 조회 완료 한 자리에서만 결과를 새로 만든다", () => {
    const ios = filesUnder("ios/Gildongmu", ".swift");
    expect(countIn(ios, /DirectionsResults\(|DirectionsResults\.init\(|\.init\(outcomes:/g)).toBe(1);
    const android = filesUnder("android/app/src/main", ".kt");
    expect(countIn(android, /DirectionsResults\(/g)).toBe(1);
  });
});
