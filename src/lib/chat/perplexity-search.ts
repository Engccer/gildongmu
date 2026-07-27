/**
 * Perplexity Search API 통합 — 채팅 search_web 도구의 실데이터 소스.
 * dodo-planet의 search_web_perplexity 이식 + 길동무 ToolResult 적응(React/Next 비의존).
 *
 * dodo는 JSON 문자열을 반환하지만 길동무는 ToolResult{data, render?}를 반환한다.
 * 에러 메시지는 LLM-facing(data.error.message) — 라우터가 사용자 언어로 직접 노출하지
 * 않고, LLM이 관찰해 사용자 언어로 실패를 재표현한다(시스템 프롬프트 지시).
 * 출처(source)는 라우터가 sourceFor("search_web")로 부착한다.
 */
import type { ToolResult } from "./types";
import type { WebSearchResult } from "@/lib/types";
import { env } from "@/lib/env";

const PERPLEXITY_SEARCH_URL = "https://api.perplexity.ai/search";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 10;
const TIMEOUT_MS = 10_000;

const VALID_RECENCY_FILTERS = new Set(["hour", "day", "week", "month", "year"]);

/**
 * 쿼리별 in-memory TTL 캐시 — /api/search/web의 unstable_cache 1시간과 등가 정책.
 * src/lib/chat은 React/Next 비의존 계약이라 next/cache를 쓸 수 없어 순수 Map으로
 * 구현한다. ⚠ 인스턴스별 캐시(rate-limit.ts와 동일 한계) — 전역 정확성보다
 * "동일 인스턴스 반복 질문 무료화"가 목적. 실패 결과는 캐시하지 않는다.
 */
export interface SearchCacheEntry {
  value: ToolResult;
  createdAt: number;
}

const CACHE_TTL_MS = 3_600_000; // 1시간(/api/search/web CACHE_TTL_SECONDS와 동조)
const CACHE_MAX_ENTRIES = 500;
const searchCache = new Map<string, SearchCacheEntry>();

export function readSearchCache(
  store: Map<string, SearchCacheEntry>,
  key: string,
  now: number,
  ttlMs: number,
): ToolResult | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (now - entry.createdAt >= ttlMs) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function writeSearchCache(
  store: Map<string, SearchCacheEntry>,
  key: string,
  value: ToolResult,
  now: number,
): void {
  if (store.size >= CACHE_MAX_ENTRIES) {
    // Map은 삽입 순서를 보존 — 가장 오래된 키부터 제거(단순 FIFO로 충분).
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, createdAt: now });
}

interface PerplexityRawResult {
  title: string;
  url: string;
  snippet: string;
  date: string | null;
  last_updated: string | null;
}

interface PerplexityResponse {
  results: PerplexityRawResult[];
  id: string;
}

/** 실패 ToolResult — 카드·출처 없이 LLM-facing data.error만 싣는다. */
function fail(error: string, message: string): ToolResult {
  return { data: { ok: false, error, message } };
}

/**
 * Perplexity Search API로 웹을 검색한다. 라우터(case "search_web")가 호출.
 *
 * @param args - Gemini function call 인자 (query·max_results·search_recency_filter)
 * @returns 성공 시 {data, render: web-results}, 실패 시 {data: {ok:false, error, message}}
 */
export async function searchWebPerplexity(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    return fail("EMPTY_QUERY", "검색어가 비어 있습니다.");
  }

  // 게이트(hasPerplexityKey)와 동일하게 zod 검증된 env를 읽는다(일관성).
  const apiKey = env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return fail("PERPLEXITY_NOT_CONFIGURED", "웹 검색이 설정되지 않았습니다.");
  }

  // max_results 파싱·clamp(1~10, 기본 5)
  const rawMax =
    typeof args.max_results === "number"
      ? args.max_results
      : parseInt(String(args.max_results ?? ""), 10);
  const maxResults = Math.min(
    Number.isNaN(rawMax) ? DEFAULT_MAX_RESULTS : Math.max(1, rawMax),
    MAX_RESULTS_LIMIT,
  );

  // recency 필터 화이트리스트(범위 밖은 무시)
  const recencyRaw = String(args.search_recency_filter ?? "");
  const recencyFilter = VALID_RECENCY_FILTERS.has(recencyRaw)
    ? recencyRaw
    : undefined;

  const cacheKey = `${query}|${maxResults}|${recencyFilter ?? ""}`;
  const cached = readSearchCache(searchCache, cacheKey, Date.now(), CACHE_TTL_MS);
  if (cached) return cached;

  const body: Record<string, unknown> = { query, max_results: maxResults };
  if (recencyFilter) body.search_recency_filter = recencyFilter;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(PERPLEXITY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return fail("PERPLEXITY_AUTH_ERROR", "웹 검색 인증에 실패했습니다.");
      }
      if (response.status === 429) {
        return fail("PERPLEXITY_RATE_LIMIT", "검색 요청이 많습니다. 잠시 후 다시 시도하세요.");
      }
      return fail("PERPLEXITY_SERVER_ERROR", "검색 서비스에 일시적인 문제가 있습니다.");
    }

    const data: PerplexityResponse = await response.json();
    const results: WebSearchResult[] = (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      date: r.date,
    }));

    const result: ToolResult = {
      // LLM 추론용: last_updated까지 포함해 시의성 판단을 돕는다.
      data: {
        ok: true,
        query,
        count: results.length,
        results: (data.results || []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          date: r.date,
          last_updated: r.last_updated,
        })),
      },
      // 카드는 결과가 있을 때만(빈 결과는 산문으로만 안내).
      render: results.length > 0 ? { type: "web-results", results } : undefined,
    };
    writeSearchCache(searchCache, cacheKey, result, Date.now());
    return result;
  } catch {
    return fail("PERPLEXITY_NETWORK_ERROR", "검색 서비스에 연결할 수 없습니다.");
  }
}
