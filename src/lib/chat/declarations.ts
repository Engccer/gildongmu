// declarations.ts — Gemini function declarations + 키 게이트 필터 (React/Next 비의존)
import type { FunctionDeclaration } from "@google/genai";
import {
  hasKakaoKey,
  hasJusoKey,
  hasSeoulSubwayRealtimeKey,
  hasDataGoKrKey,
  hasSeoulOpenDataKey,
  hasOdsayKey,
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
  {
    gate: hasDataGoKrKey,
    declaration: {
      name: "get_bus_arrivals",
      description:
        "버스 도착 정보를 보여준다. 특정 지명 주변이면 place 지정, 없으면 현재 위치.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          place: {
            type: "string",
            description: "지명(없으면 현재 위치 기준)",
          },
        },
      },
    },
  },
  {
    gate: hasSeoulOpenDataKey,
    declaration: {
      name: "get_bike_stations",
      description:
        "따릉이 공공자전거 대여소 정보를 보여준다. 특정 지명 주변이면 place 지정, 없으면 현재 위치.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          place: {
            type: "string",
            description: "지명(없으면 현재 위치 기준)",
          },
        },
      },
    },
  },
  {
    gate: hasDataGoKrKey,
    declaration: {
      name: "get_air_quality",
      description:
        "현재 위치 또는 지명 주변의 공기질(미세먼지·초미세먼지·통합대기환경지수)을 보여준다.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          place: {
            type: "string",
            description: "지명(없으면 현재 위치 기준)",
          },
        },
      },
    },
  },
  {
    // 게이트 없음 — 정적 seed 기반, 외부 키 불필요
    gate: () => true,
    declaration: {
      name: "get_station_meta",
      description:
        "지하철역의 노선·환승·영문역명 등 메타 정보를 보여준다. 역 이름을 stationName에 넣는다.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          stationName: {
            type: "string",
            description: "역 이름 (예: 강남, 서울역)",
          },
        },
        required: ["stationName"],
      },
    },
  },
  {
    gate: hasDataGoKrKey,
    declaration: {
      name: "get_station_facilities",
      description:
        "지하철역의 교통약자 편의시설(엘리베이터·장애인화장실 등)을 보여준다.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          stationName: {
            type: "string",
            description: "역 이름 (예: 강남, 서울역)",
          },
        },
        required: ["stationName"],
      },
    },
  },
  {
    gate: hasKakaoKey,
    declaration: {
      name: "get_car_route",
      description:
        "목적지까지 자동차 경로를 출발 전 텍스트로 안내한다. 목적지를 destination에 넣는다(출발지는 현재 위치).",
      parametersJsonSchema: {
        type: "object",
        properties: {
          destination: {
            type: "string",
            description: "목적지 지명 또는 주소",
          },
        },
        required: ["destination"],
      },
    },
  },
  {
    gate: hasOdsayKey,
    declaration: {
      name: "get_transit_route",
      description:
        "목적지까지 대중교통(버스·지하철 환승) 경로를 출발 전 텍스트로 안내한다. 목적지를 destination에 넣는다(출발지는 현재 위치).",
      parametersJsonSchema: {
        type: "object",
        properties: {
          destination: {
            type: "string",
            description: "목적지 지명 또는 주소",
          },
        },
        required: ["destination"],
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
