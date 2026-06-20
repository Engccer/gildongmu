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
    case "get_bus_arrivals": {
      const place = args.place ? String(args.place) : "";
      if (place) {
        const r = await searchPlaces({ query: place, lang: ctx.dataLocale });
        const p = r.places[0];
        if (p) {
          return {
            summary: `${place} 주변 버스 도착 정보를 표시했습니다.`,
            render: { type: "bus", mode: "place", lat: p.lat, lng: p.lng },
          };
        }
        return { summary: `'${place}' 위치를 찾지 못했습니다.` };
      }
      if (ctx.userLocation) {
        return {
          summary: "현재 위치 주변 버스 도착 정보를 표시했습니다.",
          render: { type: "bus", mode: "current" },
        };
      }
      return { summary: "위치를 알 수 없어 버스 도착 정보를 표시할 수 없습니다." };
    }
    case "get_bike_stations": {
      const place = args.place ? String(args.place) : "";
      if (place) {
        const r = await searchPlaces({ query: place, lang: ctx.dataLocale });
        const p = r.places[0];
        if (p) {
          return {
            summary: `${place} 주변 따릉이 대여소를 표시했습니다.`,
            render: { type: "bike", mode: "place", lat: p.lat, lng: p.lng },
          };
        }
        return { summary: `'${place}' 위치를 찾지 못했습니다.` };
      }
      if (ctx.userLocation) {
        return {
          summary: "현재 위치 주변 따릉이 대여소를 표시했습니다.",
          render: { type: "bike", mode: "current" },
        };
      }
      return { summary: "위치를 알 수 없어 따릉이 정보를 표시할 수 없습니다." };
    }
    case "get_air_quality": {
      const place = args.place ? String(args.place) : "";
      let coord = ctx.userLocation;
      if (place) {
        const r = await searchPlaces({ query: place, lang: ctx.dataLocale });
        coord = r.places[0] ? { lat: r.places[0].lat, lng: r.places[0].lng } : undefined;
      }
      if (coord) {
        return {
          summary: `${place || "현재 위치"} 공기질을 표시했습니다.`,
          render: { type: "air-quality", lat: coord.lat, lng: coord.lng },
        };
      }
      return { summary: "위치를 알 수 없어 공기질을 표시할 수 없습니다." };
    }
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}
