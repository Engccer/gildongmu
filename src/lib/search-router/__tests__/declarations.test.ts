import { describe, it, expect } from "vitest";
import { buildSearchDeclarations } from "../declarations";

describe("buildSearchDeclarations", () => {
  it("기본(includeWeb)이면 검색 의도 2종(실시간/버튼 도구 비포함)", () => {
    const names = buildSearchDeclarations().map((d) => d.name);
    expect(names).toEqual(["search_places", "search_web"]);
  });
  it("includeWeb=false면 search_web 비노출(Perplexity 키 없을 때 강등)", () => {
    const names = buildSearchDeclarations({ includeWeb: false }).map((d) => d.name);
    expect(names).toEqual(["search_places"]);
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
