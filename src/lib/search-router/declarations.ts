import type { FunctionDeclaration } from "@google/genai";

/**
 * 검색창 라우터가 Gemini에 노출하는 도구 2종(순수 데이터).
 * 채팅(14종)과 달리 검색 의도만 — 실시간/버튼 도구는 비노출(deterministic 유지).
 * search_places는 region을 선택 인자로 받아 지역 앵커링을 가능케 한다.
 */
export function buildSearchDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: "search_places",
      description:
        "장소(상호·POI)를 검색한다. 자연어에서 지역과 카테고리를 분해한다. " +
        "예: '암사동 캐나다 식당' → keyword='양식 서양음식점', region='암사동'. " +
        "'길동 카페' → keyword='카페', region='길동'.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              "장소 검색 키워드(카테고리·업종·상호). 지역명은 빼고 region에 넣는다. " +
              "실재하지 않을 법한 표현은 카카오가 찾을 만한 일반 카테고리로 바꾼다(예: '캐나다 식당'→'양식 서양음식점').",
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
    {
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
    },
  ];
}
