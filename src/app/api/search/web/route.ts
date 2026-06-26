import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { z } from "zod";
import { searchWebPerplexity } from "@/lib/chat/perplexity-search";
import { hasPerplexityKey } from "@/lib/env";
import { checkSearchWebRateLimit } from "@/lib/rate-limit";
import type { ToolResult } from "@/lib/chat/types";
import type { WebSearchResult } from "@/lib/types";

/**
 * 검색창 웹 섹션 — Perplexity Search를 GET 쿼리로 래핑한다. 장소·주소와 함께
 * 매 검색마다 병렬 호출되는 보조 섹션이라, 키 없음·결과 없음·내부 실패는 모두
 * 빈 배열로 graceful degrade한다(섹션 미렌더). LLM 분류 없음 — 결정론.
 *
 * Perplexity는 유일한 유료 API($5/1,000 req 정액)라 비용을 두 겹으로 막는다:
 *   1) IP 레이트 리밋(checkSearchWebRateLimit) — Perplexity 호출 *전*에 봇 폭주를
 *      차단(신규 쿼리 난사는 캐시로 못 막으므로 이게 1차 방어다).
 *   2) unstable_cache — 동일 쿼리를 1시간 캐시해 인기 검색어 반복 호출을 무료화한다.
 * Perplexity 호출은 POST라 다른 provider처럼 fetch `next:{revalidate}`가 안 걸려,
 * 함수 단위 unstable_cache로 캐싱한다(키: 정규화된 query).
 */
const querySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
});

const CACHE_TTL_SECONDS = 3600;

function extractWeb(tr: ToolResult): WebSearchResult[] {
  const r = tr.render;
  return r && r.type === "web-results" ? r.results : [];
}

/** Vercel은 클라이언트 IP를 x-forwarded-for(첫 항목)·x-real-ip로 전달한다. */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * 쿼리별 1시간 캐시. 성공·빈결과는 캐시하되, 실패(인증·레이트·네트워크)는 throw로
 * 캐시를 회피해 일시 장애가 굳지 않게 한다(unstable_cache는 에러를 캐시하지 않음).
 */
function cachedWebSearch(query: string): Promise<WebSearchResult[]> {
  return unstable_cache(
    async () => {
      const tr = await searchWebPerplexity({ query, max_results: 5 });
      const ok = (tr.data as { ok?: boolean } | undefined)?.ok;
      if (ok === false) throw new Error("web_search_failed");
      return extractWeb(tr);
    },
    ["search-web", query],
    { revalidate: CACHE_TTL_SECONDS },
  )();
}

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  // 키 없으면 빈 배열(섹션 미노출) — canSearchWeb 게이트와 일관, 호출 자체가 안 옴이 정상.
  if (!hasPerplexityKey()) return NextResponse.json({ web: [] });
  // 레이트 리밋 초과는 보조 섹션이라 사용자에 노출하지 않고 빈 배열로 degrade
  // (장소·주소 섹션은 계속 동작). 비용 발생 호출(Perplexity)을 호출 전에 차단.
  if (!checkSearchWebRateLimit(clientIp(request), Date.now())) {
    return NextResponse.json({ web: [] });
  }
  try {
    return NextResponse.json({ web: await cachedWebSearch(parsed.data.query) });
  } catch {
    // 보조 섹션이라 실패를 사용자에 노출하지 않고 빈 배열로 degrade.
    return NextResponse.json({ web: [] });
  }
}
