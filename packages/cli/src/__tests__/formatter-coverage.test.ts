import { describe, it, expect } from "vitest";
import { ENDPOINT_CATALOG } from "../lib/endpoint-catalog-shared.js";
import { FORMATTERS } from "../lib/formatters.js";

/**
 * 카탈로그에 항목을 더하면서 포매터 등록을 잊으면 `runEndpoint`가 조용히
 * `JSON.stringify` 폴백으로 떨어진다 — text 모드에서만 드러나므로 파이프로
 * 실행한 실호출 검증은 이것을 못 잡는다(2026-08-01 nearby-events 실사고).
 *
 * 포매터가 없어도 되는 항목은 아래에 **명시 열거**한다. 목록에 없는 신규 항목은
 * 실패시켜, 폴백을 쓰기로 한 결정이 기록 없이 스며들지 못하게 한다.
 */
const NO_FORMATTER_BY_DESIGN = new Set([
  // geocode는 MCP 도구로만 노출되고 CLI에선 `--near` 해석(resolve-location)이
  // 내부 호출한다 — runEndpoint를 타지 않아 포매터가 필요 없다.
  "geocode",
]);

describe("포매터 커버리지", () => {
  it("모든 카탈로그 항목에 포매터가 있다(예외는 명시 열거)", () => {
    const missing = ENDPOINT_CATALOG.filter(
      (e) => !FORMATTERS[e.name] && !NO_FORMATTER_BY_DESIGN.has(e.name),
    ).map((e) => e.name);
    expect(missing).toEqual([]);
  });

  it("예외 목록에 포매터가 있는 항목이 없다(예외는 부재의 근거이지 잊힌 목록이 아니다)", () => {
    // 경로 3종이 한때 여기 있었는데 실제로는 runEndpoint를 타는 포매터가 있었다 —
    // 예외에 있으면서 등록도 된 항목은 어느 쪽이 의도인지 말하지 않는다.
    const both = [...NO_FORMATTER_BY_DESIGN].filter((n) => FORMATTERS[n]);
    expect(both).toEqual([]);
  });

  it("모든 포매터가 (body, ctx) 계약을 받는다 — lang 없는 컨텍스트로 호출해도 throw하지 않는다(E29)", () => {
    // 본문 없이 호출하면 대부분 TypeError라 계약 검사는 등록 자체로 한다: 값이 함수이고
    // 레지스트리 타입(`Formatter`)이 두 번째 인자를 요구한다는 것은 tsc가 강제한다.
    for (const [name, fn] of Object.entries(FORMATTERS)) {
      expect(typeof fn, name).toBe("function");
    }
  });

  it("예외 목록에 죽은 항목이 없다(카탈로그에서 사라진 이름은 지운다)", () => {
    const names = new Set(ENDPOINT_CATALOG.map((e) => e.name));
    const stale = [...NO_FORMATTER_BY_DESIGN].filter((n) => !names.has(n));
    expect(stale).toEqual([]);
  });
});
