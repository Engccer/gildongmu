// declarations.ts — Gemini function declarations + 키 게이트 필터 (React/Next 비의존)
import type { FunctionDeclaration } from "@google/genai";
import {
  hasKakaoKey,
  hasJusoKey,
  hasSeoulSubwayRealtimeKey,
  hasDataGoKrKey,
} from "@/lib/env";

interface GatedDeclaration {
  declaration: FunctionDeclaration;
  gate: () => boolean;
}

const DECLARATIONS: GatedDeclaration[] = [
  {
    gate: hasKakaoKey,
    declaration: {
      name: "search_places",
      description:
        "키워드로 장소(상호·POI)를 검색한다. 예: '길동 카페', '강남역 맛집'. " +
        "사용자가 특정 지명/상호를 찾을 때 사용. 현재 위치 기준 거리 정렬을 원하면 useCurrentLocation=true.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색 키워드" },
          useCurrentLocation: {
            type: "boolean",
            description: "현재 위치 기준 거리 정렬 여부",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    gate: hasJusoKey,
    declaration: {
      name: "search_address",
      description:
        "도로명/지번 주소·우편번호를 검색한다. 상호(POI)가 아니라 '세종대로 110' 같은 주소를 찾을 때.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "주소 키워드" },
        },
        required: ["keyword"],
      },
    },
  },
  {
    gate: hasSeoulSubwayRealtimeKey,
    declaration: {
      name: "get_subway_arrivals",
      description:
        "현재 위치 주변 지하철역의 실시간 도착 정보를 보여준다.",
      parametersJsonSchema: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    gate: hasDataGoKrKey,
    declaration: {
      name: "get_night_clinics",
      description:
        "현재 위치 주변 소아 야간·휴일 진료 병원(달빛어린이병원)을 보여준다.",
      parametersJsonSchema: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    gate: hasKakaoKey,
    declaration: {
      name: "get_kids_places",
      description:
        "현재 위치 주변 아이 놀 곳(키즈카페·놀이터·어린이공원)을 보여준다.",
      parametersJsonSchema: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    gate: hasKakaoKey,
    declaration: {
      name: "get_surroundings",
      description:
        "현재 위치 주변 편의점·음식점·약국 등 주변 장소를 방위·거리와 함께 보여준다.",
      parametersJsonSchema: {
        type: "object",
        properties: {},
      },
    },
  },
];

/** 전체 도구 선언 목록 (게이트 무관) */
export const ALL_DECLARATIONS: FunctionDeclaration[] = DECLARATIONS.map(
  (d) => d.declaration
);

/** 게이트를 통과한 도구 선언만 반환 */
export function availableDeclarations(): FunctionDeclaration[] {
  return DECLARATIONS.filter((d) => d.gate()).map((d) => d.declaration);
}
