import type { GoogleGenAI, FunctionCall, Part } from "@google/genai";
import { GEMINI_MODEL } from "@/lib/gemini/client";
import { buildSearchDeclarations } from "./declarations";
import type { SearchIntent } from "./types";

/** classify가 필요로 하는 최소 클라이언트 표면(테스트 mock 가능). */
export type ClassifyClient = Pick<GoogleGenAI, "models">;

const SYSTEM_INSTRUCTION =
  "너는 검색창 쿼리 분류기다. 사용자의 자연어 검색어를 정확히 하나의 도구로 분류한다. " +
  "장소/상호/지역 검색이면 search_places로, 지역명과 카테고리를 분해한다(지역명은 region, 나머지는 keyword). " +
  "⚠ keyword는 카카오 지도가 매칭할 수 있는 '단일 카테고리어' 하나여야 한다(예: '카페', '양식', '레스토랑', " +
  "'이탈리안', '치과', '약국'). 여러 단어를 나열하거나 수식어를 붙이지 마라 — '양식 서양음식점'처럼 구문으로 " +
  "만들면 그 단어가 든 상호명만 걸려 엉뚱한 결과가 나온다. 특정 국가·드문 음식이면 가장 가까운 단일 카테고리어로 " +
  "바꾼다(예: '캐나다 식당'→'레스토랑', '쌀국수집'→'베트남음식', '조용한 카페'→'카페'). " +
  "시의성 웹 정보(뉴스·정책·환율·시세 등)면 search_web으로 분류한다. " +
  "산문이나 설명을 절대 출력하지 말고 반드시 도구를 호출한다.";

function firstFunctionCall(parts: Part[] | undefined): FunctionCall | null {
  if (!parts) return null;
  for (const p of parts) {
    if ("functionCall" in p && p.functionCall) return p.functionCall;
  }
  return null;
}

/**
 * Gemini 단발 분류(1왕복, 결과 관찰 없음). functionCall을 SearchIntent로 파싱한다.
 * 무응답·알 수 없는 도구·빈 keyword/query·throw는 모두 { kind:"place", keyword: query }로
 * graceful degrade(현행 naive 검색과 동일 동작) — 사용자에 에러를 노출하지 않는다.
 */
export async function classifySearchQuery(opts: {
  query: string;
  locale: string;
  ai: ClassifyClient;
  /** Perplexity 키가 있을 때만 search_web을 노출(키 없으면 웹 질의도 place로 강등). */
  includeWeb?: boolean;
}): Promise<SearchIntent> {
  const { query, locale, ai, includeWeb = true } = opts;
  const fallback: SearchIntent = { kind: "place", keyword: query };
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: `[locale=${locale}] ${query}` }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: buildSearchDeclarations({ includeWeb }) }],
      },
    });
    const call = firstFunctionCall(res.candidates?.[0]?.content?.parts);
    if (!call) return fallback;

    if (call.name === "search_web") {
      const webQuery = String(call.args?.query ?? "").trim();
      if (!webQuery) return fallback;
      const recency = call.args?.recency ? String(call.args.recency) : undefined;
      return { kind: "web", query: webQuery, ...(recency ? { recency } : {}) };
    }
    if (call.name === "search_places") {
      const keyword = String(call.args?.keyword ?? "").trim() || query;
      const region = call.args?.region ? String(call.args.region).trim() : "";
      return { kind: "place", keyword, ...(region ? { region } : {}) };
    }
    return fallback;
  } catch {
    return fallback;
  }
}
