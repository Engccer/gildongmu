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
   * 도구 입력 스키마는 카탈로그 params에서 자동 생성되므로, 여기 없는 도구는 에이전트가
   * 영어를 요청할 방법 자체가 없다. 이 단언은 **그 목록의 고정**만 본다 — 서버 라우트가
   * lang을 새로 받는데 카탈로그가 안 따라가는 드리프트는 카탈로그 자기 자신을 봐서는
   * 알 수 없으므로 `packages/cli`의 `catalog-lang-drift.test.ts`(라우트 소스 스캔)가 맡는다.
   */
  it("lang 입력을 노출하는 도구 목록이 고정돼 있다", () => {
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
