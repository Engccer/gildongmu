import type { FunctionDeclaration } from "@google/genai";

/**
 * 검색창 라우터가 Gemini에 노출하는 도구(순수 데이터).
 * 채팅(14종)과 달리 검색 의도만 — 실시간/버튼 도구는 비노출(deterministic 유지).
 * search_places는 region을 선택 인자로 받아 지역 앵커링을 가능케 한다.
 *
 * includeWeb: Perplexity 키가 있을 때만 search_web을 노출한다(채팅 availableDeclarations
 * 게이트 패턴 — 키 없는 도구를 모델이 호출 못 하게). 키 없으면 웹 질의도 search_places로
 * graceful 강등(빈 결과+무통지 회귀 차단).
 */
export function buildSearchDeclarations(
  opts: { includeWeb?: boolean } = {},
): FunctionDeclaration[] {
  const { includeWeb = true } = opts;
  const decls: FunctionDeclaration[] = [
    {
      name: "search_places",
      description:
        "장소(상호·POI)를 검색한다. 자연어에서 지역과 카테고리를 분해한다. " +
        "예: '암사동 캐나다 식당' → keyword='레스토랑', region='암사동'. " +
        "'길동 조용한 카페' → keyword='카페', region='길동'.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              "카카오 지도가 매칭할 단일 카테고리어 하나(예: '카페', '양식', '레스토랑', '이탈리안', '약국'). " +
              "지역명은 빼고 region에 넣는다. 여러 단어·수식어를 붙이지 않는다('양식 서양음식점'처럼 구문으로 " +
              "만들면 상호명만 걸려 빗나간다). 드문 표현은 가장 가까운 단일 카테고리어로(예: '캐나다 식당'→'레스토랑').",
          },
          region: {
            type: "string",
            description:
              "검색 기준 지역/동/역 이름(있을 때만). 예: '암사동', '강동역', '강남'. 없으면 생략(현재 위치 기준).",
          },
        },
        required: ["keyword"],
      },
    },
  ];
  if (includeWeb) {
    decls.push({
      name: "search_web",
      description:
        "장소가 아니라 시의성 웹 정보를 찾을 때. 예: '환율 최신', '스페인 입국 정책', '오늘 날씨 뉴스'. " +
        "특정 상호/지역 장소 검색이면 이 도구가 아니라 search_places를 쓴다.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "웹 검색어" },
          recency: {
            type: "string",
            enum: ["hour", "day", "week", "month", "year"],
            description: "시간 필터(선택) — 최신성이 중요할 때만.",
          },
        },
        required: ["query"],
      },
    });
  }
  return decls;
}
