import { describe, it, expect } from "vitest";
import { buildSearchDeclarations } from "../declarations";

describe("buildSearchDeclarations", () => {
  it("검색 의도 2종만 노출(실시간/버튼 도구 비포함)", () => {
    const names = buildSearchDeclarations().map((d) => d.name);
    expect(names).toEqual(["search_places", "search_web"]);
  });
  it("search_places는 keyword 필수·region 선택", () => {
    const decl = buildSearchDeclarations().find((d) => d.name === "search_places")!;
    const schema = decl.parametersJsonSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(["keyword", "region"]);
    expect(schema.required).toEqual(["keyword"]);
  });
});
