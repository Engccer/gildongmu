import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/lib/providers/places";
import { searchAddress } from "@/lib/providers/kakao-address";
import { searchWebPerplexity } from "@/lib/chat/perplexity-search";
import type { ToolResult } from "@/lib/chat/types";
import { getGeminiClient } from "@/lib/gemini/client";
import { hasGeminiKey, hasPerplexityKey, hasKakaoKey } from "@/lib/env";
import { dataLocale } from "@/lib/data-locale";
import { classifySearchQuery } from "@/lib/search-router/classify";
import { pickAnchor, shouldFallbackToWeb } from "@/lib/search-router/flow";
import type { RouterAnchor, SearchRouteResult } from "@/lib/search-router/types";
import type { WebSearchResult } from "@/lib/types";

/**
 * 검색창 자연어 라우터 — Gemini 단발 분류로 search_places(+지역 앵커)/search_web 중
 * 하나를 골라 실행한다. 주소(juso)는 이 라우트가 아니라 클라이언트가 /api/address/search로
 * 병렬 호출한다(무료·결정론 — LLM 뒤에 둘 이유 없음). Gemini 키 없으면 naive 장소검색(회귀 0).
 */

const querySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
  lang: z.enum(["ko", "en"]).default("ko"),
  lat: z.coerce.number().min(-90).max(90).optional().catch(undefined),
  lng: z.coerce.number().min(-180).max(180).optional().catch(undefined),
});

/** searchWebPerplexity ToolResult의 render에서 웹 결과 배열을 추출(없으면 빈 배열). */
function extractWeb(toolResult: ToolResult): WebSearchResult[] {
  const r = toolResult.render;
  return r && r.type === "web-results" ? r.results : [];
}

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
    lang: request.nextUrl.searchParams.get("lang") ?? undefined,
    lat: request.nextUrl.searchParams.get("lat") ?? undefined,
    lng: request.nextUrl.searchParams.get("lng") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  const { query, lang, lat, lng } = parsed.data;
  const dl = dataLocale(lang);
  const userCoords: RouterAnchor | null =
    lat != null && lng != null ? { lat, lng } : null;

  // naive 장소검색(라우터 미적용/폴백 공통).
  const naivePlace = async (): Promise<SearchRouteResult> => {
    const r = await searchPlaces({ query, lang: dl, lat, lng });
    return { kind: "place", places: r.places };
  };

  try {
    // 1. Gemini 키 없음 → 현행 결정론 동작.
    if (!hasGeminiKey()) {
      return NextResponse.json(await naivePlace());
    }
    const ai = getGeminiClient();
    if (!ai) return NextResponse.json(await naivePlace());

    // 2. 단발 분류. Perplexity 키가 없으면 search_web을 노출하지 않아 웹 질의도
    //    place로 강등된다(빈 결과+무통지 회귀 차단).
    const webEnabled = hasPerplexityKey();
    const intent = await classifySearchQuery({
      query,
      locale: lang,
      ai,
      includeWeb: webEnabled,
    });

    // 3-A. 웹 라우팅(길 A). 방어: 키 없는데 web으로 분류되면 naive 장소검색으로 강등.
    if (intent.kind === "web") {
      if (!webEnabled) return NextResponse.json(await naivePlace());
      const tr = await searchWebPerplexity({
        query: intent.query,
        ...(intent.recency ? { search_recency_filter: intent.recency } : {}),
      });
      const result: SearchRouteResult = { kind: "web", web: extractWeb(tr) };
      return NextResponse.json(result);
    }

    // 3-B. 장소(지역 앵커링).
    let geocoded: RouterAnchor | null = null;
    if (intent.region && hasKakaoKey()) {
      try {
        const matches = await searchAddress(intent.region, 1);
        const m = matches[0];
        if (m && typeof m.lat === "number" && typeof m.lng === "number") {
          geocoded = { lat: m.lat, lng: m.lng };
        }
      } catch {
        geocoded = null; // 지오코딩 실패 → userCoords 앵커로 graceful
      }
    }
    const anchor = pickAnchor(geocoded, userCoords);
    const placeR = await searchPlaces({
      query: intent.keyword,
      lang: dl,
      lat: anchor?.lat,
      lng: anchor?.lng,
    });

    // 3-C. 0건 → 웹 폴백(길 B, 코드 결정).
    if (shouldFallbackToWeb(placeR.places.length, webEnabled)) {
      const tr = await searchWebPerplexity({ query });
      const web = extractWeb(tr);
      if (web.length > 0) {
        const result: SearchRouteResult = { kind: "web", web, fallbackFrom: "place" };
        return NextResponse.json(result);
      }
    }
    const result: SearchRouteResult = { kind: "place", places: placeR.places };
    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/search] 라우터 실패, naive 폴백 시도:", e);
    // 분류/실행 중 예외 → naive 장소검색으로 최후 폴백, 그것도 실패면 502.
    try {
      return NextResponse.json(await naivePlace());
    } catch {
      return NextResponse.json(
        { error: "검색에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 502 },
      );
    }
  }
}
