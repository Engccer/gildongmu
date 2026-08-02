import { describe, it, expect } from "vitest";
import { dist } from "../lib/formatters.js";
import { formatDistance } from "../../../../src/lib/format.js";

/**
 * CLI `dist()`는 웹 `formatDistance`의 미러다. 갈리면 같은 거리가 웹·앱과 CLI에서
 * 다르게 낭독된다(종전엔 이 가드가 없었다).
 *
 * 웹 `src/lib/format.ts`는 React/Next 비의존 순수 모듈이라 이 패키지에서 직접
 * import해 **실행 대조**할 수 있다. Kit(Swift)은 실행할 수 없어 표 대조로 가는데
 * (`src/lib/__tests__/format-drift.test.ts`), 여기선 그럴 이유가 없다.
 */
describe("거리 표기 CLI-웹 드리프트", () => {
  // 경계·자리올림·소수 구간을 함께 훑는다. 표를 손으로 적지 않고 정본을 실행해
  // 대조하므로, 규칙이 바뀌면 두 구현이 함께 따라오지 않는 한 red가 된다.
  const inputs = [
    0, 1, 120, 120.4, 999, 999.6, 1000, 1049, 1050, 1187, 1500, 1950, 1999,
    3640, 9999, 10_000, 89_700, 123_456,
  ];

  it.each(inputs)("%dm에서 웹 정본과 같은 문자열", (meters) => {
    expect(dist(meters)).toBe(formatDistance(meters));
  });
});
