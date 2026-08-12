import { describe, expect, it } from "vitest";
import { orderDirectionsModes, type DirectionsModeKey } from "../directions-order";
import scenarios from "./fixtures/directions-order-scenarios.json";

type OrderCase = {
  name: string;
  modes: DirectionsModeKey[];
  success: Partial<Record<DirectionsModeKey, boolean>>;
  walkDurationSeconds: number | null;
  expect: DirectionsModeKey[];
};

describe("orderDirectionsModes (공유 fixture — Kit 미러 동조)", () => {
  const cases = scenarios.order as OrderCase[];
  // 공회전 방지: fixture가 비면 아래 루프가 0회 돌고 조용히 통과한다(Kit 테스트와 같은 가드).
  it("fixture에 경계 케이스가 있다", () => {
    expect(cases.length).toBeGreaterThanOrEqual(9);
  });
  for (const c of cases) {
    it(c.name, () => {
      expect(orderDirectionsModes(c.modes, c.success, c.walkDurationSeconds)).toEqual(c.expect);
    });
  }
  it("입력 배열을 변경하지 않는다", () => {
    const modes: DirectionsModeKey[] = ["transit", "car", "walk"];
    orderDirectionsModes(modes, { walk: true }, 600);
    expect(modes).toEqual(["transit", "car", "walk"]);
  });
});
