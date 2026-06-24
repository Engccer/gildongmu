import type { Place, WebSearchResult } from "@/lib/types";

/** 라우터 앵커 좌표(WGS84). */
export type RouterAnchor = { lat: number; lng: number };

/**
 * Gemini 단발 분류 결과. place(지역·키워드 추출) 또는 web(시의성 질의) 중 하나.
 * recency는 Perplexity search_recency_filter 화이트리스트(hour|day|week|month|year).
 */
export type SearchIntent =
  | { kind: "place"; keyword: string; region?: string }
  | { kind: "web"; query: string; recency?: string };

/**
 * 라우트가 클라이언트에 돌려주는 판별 결과. place와 web은 상호배타.
 * fallbackFrom:"place" = 장소 0건이라 코드가 결정적으로 웹 폴백한 경우(길 B).
 */
export type SearchRouteResult =
  | { kind: "place"; places: Place[] }
  | { kind: "web"; web: WebSearchResult[]; fallbackFrom?: "place" };
