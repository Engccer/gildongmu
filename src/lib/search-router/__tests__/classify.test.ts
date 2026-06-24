import { describe, it, expect, vi } from "vitest";
import { classifySearchQuery } from "../classify";

/** functionCall 1개를 담은 가짜 Gemini 응답을 만드는 헬퍼. */
function mockAi(fn: { name: string; args: Record<string, unknown> } | null) {
  const parts = fn ? [{ functionCall: fn }] : [{ text: "" }];
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts } }],
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("classifySearchQuery", () => {
  // 복합 의미 쿼리에서 모델이 지역·카테고리를 분해한 응답을 그대로 통과시킨다.
  // (keyword 정규화 — 단일 카테고리어 — 는 systemInstruction이 모델에 유도하는 책임이고,
  //  classify는 model 응답을 정제하지 않는다. 여기선 그 pass-through를 검증.)
  it("복합 의미 쿼리 → place{region,keyword} 분해 통과", async () => {
    const ai = mockAi({
      name: "search_places",
      args: { keyword: "레스토랑", region: "암사동" },
    });
    const intent = await classifySearchQuery({
      query: "암사동 캐나다 식당",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({
      kind: "place",
      keyword: "레스토랑",
      region: "암사동",
    });
  });

  it("시의성 질의 → web{query}", async () => {
    const ai = mockAi({ name: "search_web", args: { query: "환율 최신" } });
    const intent = await classifySearchQuery({
      query: "환율 최신",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "web", query: "환율 최신" });
  });

  it("region 없는 단순 장소 → place{keyword}", async () => {
    const ai = mockAi({ name: "search_places", args: { keyword: "카페" } });
    const intent = await classifySearchQuery({
      query: "길동 카페",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "카페" });
  });

  it("functionCall 없음 → place 기본값(원쿼리)", async () => {
    const ai = mockAi(null);
    const intent = await classifySearchQuery({
      query: "강남역 맛집",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "강남역 맛집" });
  });

  it("알 수 없는 도구 → place 기본값", async () => {
    const ai = mockAi({ name: "do_something", args: {} });
    const intent = await classifySearchQuery({
      query: "뭔가",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "뭔가" });
  });

  it("빈 keyword면 원쿼리로 보정", async () => {
    const ai = mockAi({ name: "search_places", args: { keyword: "" } });
    const intent = await classifySearchQuery({
      query: "강동 분식",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "강동 분식" });
  });

  it("web인데 query가 비면 place 기본값으로 보정", async () => {
    const ai = mockAi({ name: "search_web", args: { query: "" } });
    const intent = await classifySearchQuery({
      query: "이상한웹",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "이상한웹" });
  });

  it("web recency 화이트리스트 통과 시 보존", async () => {
    const ai = mockAi({
      name: "search_web",
      args: { query: "환율", recency: "day" },
    });
    const intent = await classifySearchQuery({
      query: "환율",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "web", query: "환율", recency: "day" });
  });

  it("Gemini throw → place 기본값(graceful degrade)", async () => {
    const ai = {
      models: { generateContent: vi.fn().mockRejectedValue(new Error("boom")) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const intent = await classifySearchQuery({
      query: "에러쿼리",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "에러쿼리" });
  });
});
