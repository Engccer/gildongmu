import { describe, it, expect } from "vitest";
import { ENDPOINT_CATALOG } from "../endpoint-catalog-shared.js";

describe("MCP 도구 카탈로그 필터·이름 규칙", () => {
  const mcpTools = ENDPOINT_CATALOG.filter((e) => e.mcp);

  it("mcp:true 항목이 27개(web-search 1건만 제외)", () => {
    expect(ENDPOINT_CATALOG.length).toBe(28);
    expect(mcpTools.length).toBe(27);
    expect(ENDPOINT_CATALOG.filter((e) => !e.mcp).map((e) => e.name)).toEqual(["web-search"]);
  });

  it("모든 도구명이 하이픈 없는 스네이크케이스로 변환된다", () => {
    for (const spec of mcpTools) {
      const toolName = spec.name.replaceAll("-", "_");
      expect(toolName).not.toContain("-");
      expect(toolName).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("변환된 도구명에 중복이 없다", () => {
    const names = mcpTools.map((spec) => spec.name.replaceAll("-", "_"));
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * E26/E27 — MCP는 에이전트 창구라 영어권 에이전트가 한국어 문장을 받는 상태를 남기지
   * 않는다. 도구 입력 스키마는 카탈로그 params에서 자동 생성되므로, 서버가 `lang`을
   * 받는 엔드포인트가 카탈로그에서 빠지면 그 도구는 영어를 요청할 방법 자체가 없다.
   * 목록을 손으로 적어 둔다 — 새 lang 라우트가 생기면 이 단언이 실패해 등록을 강제한다.
   */
  it("서버가 lang을 받는 엔드포인트 전부가 lang 입력을 노출한다", () => {
    const withLang = ENDPOINT_CATALOG.filter((e) => e.params.some((p) => p.key === "lang"))
      .map((e) => e.name)
      .sort();
    expect(withLang).toEqual([
      "nearby-subway",
      "places-search",
      "route-car",
      "route-transit",
      "route-walk",
      "station-meta",
      "station-timetable",
      "subway-arrival",
    ]);
  });

  it("lang은 어디서도 필수가 아니다(누락=ko는 서버 계약, 에이전트에 강요하지 않는다)", () => {
    for (const spec of ENDPOINT_CATALOG) {
      const lang = spec.params.find((p) => p.key === "lang");
      if (lang) expect(lang.required).toBe(false);
    }
  });
});
