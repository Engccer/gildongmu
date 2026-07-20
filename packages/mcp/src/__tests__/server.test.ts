import { describe, it, expect } from "vitest";
import { ENDPOINT_CATALOG } from "../endpoint-catalog-shared.js";

describe("MCP 도구 카탈로그 필터·이름 규칙", () => {
  const mcpTools = ENDPOINT_CATALOG.filter((e) => e.mcp);

  it("mcp:true 항목이 21개(web-search 1건만 제외)", () => {
    expect(ENDPOINT_CATALOG.length).toBe(22);
    expect(mcpTools.length).toBe(21);
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
});
