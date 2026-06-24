import type { GoogleGenAI, FunctionCall, Part } from "@google/genai";
import { GEMINI_MODEL } from "@/lib/gemini/client";
import { buildSearchDeclarations } from "./declarations";
import type { SearchIntent } from "./types";

/** classify가 필요로 하는 최소 클라이언트 표면(테스트 mock 가능). */
export type ClassifyClient = Pick<GoogleGenAI, "models">;

const SYSTEM_INSTRUCTION =
  "너는 검색창 쿼리 분류기다. 사용자의 자연어 검색어를 정확히 하나의 도구로 분류한다. " +
  "장소/상호/지역 검색이면 search_places로, 지역명과 카테고리를 분해한다(지역명은 region, 나머지는 keyword). " +
  "실재하지 않을 법한 표현은 카카오가 찾을 일반 카테고리로 바꾼다(예: '캐나다 식당'→'양식 서양음식점'). " +
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
}): Promise<SearchIntent> {
  const { query, locale, ai } = opts;
  const fallback: SearchIntent = { kind: "place", keyword: query };
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: `[locale=${locale}] ${query}` }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: buildSearchDeclarations() }],
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
