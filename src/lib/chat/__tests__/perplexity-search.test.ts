import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSearchCache, writeSearchCache, type SearchCacheEntry } from "../perplexity-search";

// dodo-planet의 perplexity-search 테스트 이식 — 길동무 ToolResult 적응
// (JSON 문자열 파싱 대신 result.data / result.render 직접 검증).

// 캐시 코어는 store·now 주입형이라 결정적으로 검증한다(rate-limit 테스트 동형).
describe("searchWebPerplexity 캐시 코어", () => {
  it("TTL 내 동일 키는 캐시 적중, TTL 경과 후 미스", () => {
    const store = new Map<string, SearchCacheEntry>();
    const value = { ok: true } as never;
    writeSearchCache(store, "k", value, 1_000);
    expect(readSearchCache(store, "k", 1_000 + 3_599_000, 3_600_000)).toBe(value);
    expect(readSearchCache(store, "k", 1_000 + 3_600_000, 3_600_000)).toBeNull();
  });

  it("용량 상한 도달 시 가장 오래된 항목부터 제거", () => {
    const store = new Map<string, SearchCacheEntry>();
    for (let i = 0; i < 501; i++) writeSearchCache(store, `k${i}`, {} as never, i);
    expect(store.size).toBeLessThanOrEqual(500);
    expect(store.has("k0")).toBe(false);
  });
});

const mockSearchResponse = {
  results: [
    {
      title: "Spain Travel Guide 2026",
      url: "https://example.com/spain-guide",
      snippet: "Updated travel requirements for Spain in 2026...",
      date: "2026-02-25",
      last_updated: "2026-02-27",
    },
    {
      title: "Barcelona Airport Updates",
      url: "https://example.com/bcn-airport",
      snippet: "New terminal construction at BCN...",
      date: "2026-02-20",
      last_updated: null,
    },
  ],
  id: "search-123",
};

const mockFetchOk = () => ({ ok: true, status: 200, json: () => Promise.resolve(mockSearchResponse) });
const mockFetch401 = () => ({ ok: false, status: 401, json: () => Promise.resolve({}) });
const mockFetch429 = () => ({ ok: false, status: 429, json: () => Promise.resolve({}) });
const mockFetch500 = () => ({ ok: false, status: 500, json: () => Promise.resolve({}) });

describe("searchWebPerplexity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("PERPLEXITY_API_KEY", "test-key-123");
  });

  it("성공 시 정규화된 결과 data + web-results 카드를 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchOk()));
    const { searchWebPerplexity } = await import("../perplexity-search");

    const result = await searchWebPerplexity({ query: "spain travel 2026" });

    expect(result.data.ok).toBe(true);
    expect(result.data.count).toBe(2);
    expect(result.render).toEqual({
      type: "web-results",
      results: expect.arrayContaining([
        expect.objectContaining({ title: "Spain Travel Guide 2026", url: expect.any(String) }),
      ]),
    });
    // 카드 결과는 last_updated를 싣지 않는다(LLM data에만).
    expect((result.render as { results: unknown[] }).results).toHaveLength(2);
  });

  it("빈 쿼리를 거부한다(카드 없음)", async () => {
    const { searchWebPerplexity } = await import("../perplexity-search");
    const result = await searchWebPerplexity({ query: "" });
    expect(result.data.ok).toBe(false);
    expect(result.data.error).toBe("EMPTY_QUERY");
    expect(result.render).toBeUndefined();
  });

  it("max_results를 10으로 clamp한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchOk()));
    const { searchWebPerplexity } = await import("../perplexity-search");

    await searchWebPerplexity({ query: "test", max_results: 50 });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.max_results).toBe(10);
  });

  it("max_results 문자열도 파싱한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchOk()));
    const { searchWebPerplexity } = await import("../perplexity-search");

    await searchWebPerplexity({ query: "test", max_results: "3" });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.max_results).toBe(3);
  });

  it("401 인증 오류를 처리한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetch401()));
    const { searchWebPerplexity } = await import("../perplexity-search");
    const result = await searchWebPerplexity({ query: "test" });
    expect(result.data.ok).toBe(false);
    expect(result.data.error).toBe("PERPLEXITY_AUTH_ERROR");
    expect(result.render).toBeUndefined();
  });

  it("429 레이트리밋을 처리한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetch429()));
    const { searchWebPerplexity } = await import("../perplexity-search");
    const result = await searchWebPerplexity({ query: "test" });
    expect(result.data.error).toBe("PERPLEXITY_RATE_LIMIT");
  });

  it("500 서버 오류를 처리한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetch500()));
    const { searchWebPerplexity } = await import("../perplexity-search");
    const result = await searchWebPerplexity({ query: "test" });
    expect(result.data.error).toBe("PERPLEXITY_SERVER_ERROR");
  });

  it("키 없음을 처리한다", async () => {
    // env(zod)는 ""에서 min(1) 실패로 throw하므로 undefined로 키를 제거한다.
    vi.stubEnv("PERPLEXITY_API_KEY", undefined);
    const { searchWebPerplexity } = await import("../perplexity-search");
    const result = await searchWebPerplexity({ query: "test" });
    expect(result.data.error).toBe("PERPLEXITY_NOT_CONFIGURED");
  });

  it("fetch 타임아웃/네트워크 오류를 처리한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("AbortError")));
    const { searchWebPerplexity } = await import("../perplexity-search");
    const result = await searchWebPerplexity({ query: "test" });
    expect(result.data.error).toBe("PERPLEXITY_NETWORK_ERROR");
  });

  it("search_recency_filter를 전달한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchOk()));
    const { searchWebPerplexity } = await import("../perplexity-search");

    await searchWebPerplexity({ query: "test", search_recency_filter: "day" });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.search_recency_filter).toBe("day");
  });

  it("잘못된 recency 필터는 무시한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchOk()));
    const { searchWebPerplexity } = await import("../perplexity-search");

    await searchWebPerplexity({ query: "test", search_recency_filter: "decade" });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.search_recency_filter).toBeUndefined();
  });

  it("동일 인자 2회 호출 시 fetch 1회(in-memory 캐시 적중)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchOk()));
    const { searchWebPerplexity } = await import("../perplexity-search");

    const first = await searchWebPerplexity({ query: "cache me" });
    const second = await searchWebPerplexity({ query: "cache me" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("실패 결과는 캐시하지 않는다(재시도 시 fetch 재호출)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(mockFetch500()).mockResolvedValueOnce(mockFetchOk()),
    );
    const { searchWebPerplexity } = await import("../perplexity-search");

    const first = await searchWebPerplexity({ query: "retry me" });
    expect(first.data.error).toBe("PERPLEXITY_SERVER_ERROR");

    const second = await searchWebPerplexity({ query: "retry me" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(second.data.ok).toBe(true);
  });
});
