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
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}
