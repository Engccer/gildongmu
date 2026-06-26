import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchWebPerplexity } from "@/lib/chat/perplexity-search";
import { hasPerplexityKey } from "@/lib/env";
import type { ToolResult } from "@/lib/chat/types";
import type { WebSearchResult } from "@/lib/types";

/**
 * 검색창 웹 섹션 — Perplexity Search를 GET 쿼리로 래핑한다. 장소·주소와 함께
 * 매 검색마다 병렬 호출되는 보조 섹션이라, 키 없음·결과 없음·내부 실패는 모두
 * 빈 배열로 graceful degrade한다(섹션 미렌더). LLM 분류 없음 — 결정론.
 */
const querySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
});

function extractWeb(tr: ToolResult): WebSearchResult[] {
  const r = tr.render;
  return r && r.type === "web-results" ? r.results : [];
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
  try {
    const tr = await searchWebPerplexity({ query: parsed.data.query, max_results: 5 });
    return NextResponse.json({ web: extractWeb(tr) });
  } catch {
    // 보조 섹션이라 실패를 사용자에 노출하지 않고 빈 배열로 degrade.
    return NextResponse.json({ web: [] });
  }
}
