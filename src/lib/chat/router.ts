/**
 * Gemini function call → provider 디스패치 라우터.
 * React/Next 비의존 — dodo-planet 이식 가능.
 *
 * Phase 3에서 case가 추가된다. search_places만 구현.
 */

import type { ExecutionContext, ToolResult } from "./types";
import { searchPlaces } from "@/lib/providers/places";
import { searchJusoAddresses } from "@/lib/providers/juso-address";
import { placesToRender, placesSummary, addressesToRender, addressesSummary } from "./render";

/**
 * Gemini 도구 호출을 provider로 디스패치하고 ToolResult를 반환한다.
 *
 * @param name  - Gemini가 호출한 함수 이름
 * @param args  - Gemini가 전달한 인자 (타입 미보장, 방어 처리 필요)
 * @param ctx   - 실행 컨텍스트 (위치·로케일)
 */
export async function executeFunction(
  name: string,
  args: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ToolResult> {
  switch (name) {
    case "search_places": {
      const query = String(args.query ?? "");
      // searchPlaces 내부에서 lang==="en"이면 searchPlacesMergedEn을 자동 호출한다
      const result = await searchPlaces({ query, lang: ctx.dataLocale });
      return {
        summary: placesSummary(result.places, ctx.locale),
        render: placesToRender(result.places),
      };
    }
    case "search_address": {
      const keyword = String(args.keyword ?? "");
      const results = await searchJusoAddresses(keyword);
      return {
        summary: addressesSummary(results, ctx.locale),
        render: addressesToRender(results),
      };
    }
    case "get_subway_arrivals":
      return {
        summary: "주변 지하철 도착 정보를 아래에 표시했습니다.",
        render: { type: "subway-nearby" },
      };
    case "get_night_clinics":
      return {
        summary: "주변 소아 야간·휴일 진료 병원을 아래에 표시했습니다.",
        render: { type: "clinics-nearby" },
      };
    case "get_kids_places":
      return {
        summary: "주변 아이 놀 곳을 아래에 표시했습니다.",
        render: { type: "kids-nearby" },
      };
    case "get_surroundings":
      return {
        summary: "주변 장소를 아래에 표시했습니다.",
        render: { type: "surroundings-nearby" },
      };
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}
