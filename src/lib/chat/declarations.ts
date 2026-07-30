// declarations.ts — Gemini function declarations + 키 게이트 필터 (React/Next 비의존)
import type { FunctionDeclaration } from "@google/genai";
import {
  hasKakaoKey,
  hasJusoKey,
  hasSeoulSubwayRealtimeKey,
  hasDataGoKrKey,
  hasSeoulOpenDataKey,
  hasOdsayKey,
  hasWalkRouteKey,
  hasCarRouteKey,
  hasPerplexityKey,
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
        "사용자가 특정 지명/상호를 찾을 때 사용.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색 키워드" },
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
        "현재 위치 또는 지명 주변의 공기질(미세먼지·초미세먼지·통합대기환경지수)을 보여준다. 사용자가 공기질·미세먼지·대기 상태를 직접 묻거나 야외 활동 적합성을 물을 때만 호출하고, 호출할 때는 날씨가 긴밀히 연관되므로 get_weather도 함께 호출한다.",
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
      name: "get_weather",
      description:
        "현재 위치 또는 지명 주변의 현재 날씨(기온·하늘상태·강수·습도·강수확률·오늘 최고/최저)를 보여준다. 사용자가 날씨·기온·비·눈이나 공기질·미세먼지를 직접 묻거나 야외 활동 적합성을 물을 때만 호출한다.",
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
    gate: hasCarRouteKey,
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
    gate: hasDataGoKrKey,
    declaration: {
      name: "get_nearby_barrier_free",
      description:
        "현재 위치(또는 보고 있는 장소) 주변의 무장애 관광지(휠체어·점자블록·음성안내 등 장애인 편의시설을 갖춘 곳)를 보여준다.",
      parametersJsonSchema: { type: "object", properties: {} },
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
  {
    // 게이트 없음 - 음향신호기는 무인증 seed, OSM은 무키 공개 인스턴스(spec §4)
    gate: () => true,
    declaration: {
      name: "get_walk_infrastructure",
      description:
        "현재 위치(또는 보고 있는 장소) 주변 음향신호기·횡단보도·점자블록을 보여준다. " +
        "서울시·OpenStreetMap 등록 자료 기준이며, 실제 시설 유무나 작동 상태와 다를 수 있다.",
      parametersJsonSchema: { type: "object", properties: {} },
    },
  },
  {
    gate: hasWalkRouteKey,
    declaration: {
      name: "get_walk_route",
      description:
        "목적지까지 도보(걷기) 경로를 출발 전 텍스트로 안내한다. 목적지를 destination에 넣는다(출발지는 현재 위치).",
      parametersJsonSchema: {
        type: "object",
        properties: {
          destination: {
            type: "string",
            description: "목적지 지명 또는 주소",
          },
          accessible: {
            type: "boolean",
            description:
              "계단 회피·엘리베이터 경로를 명시 요청할 때만 true(예: '계단 없는 길로', '엘리베이터로 갈 수 있는 경로').",
          },
        },
        required: ["destination"],
      },
    },
  },
  {
    gate: hasPerplexityKey,
    declaration: {
      name: "search_web",
      description:
        "최신 뉴스·실시간 정책·공식 발표·환율·임시 운영시간 등 최근 웹 데이터를 검색한다. " +
        "국내 장소·교통·공기질·날씨처럼 전용 도구로 답할 수 있는 건 그쪽을 우선하고, " +
        "전용 도구가 못 다루는 시의성 정보일 때만 사용한다. 결과의 출처를 답변에 반영하라.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "관련 결과가 가장 잘 나올 언어로 작성한 검색어",
          },
          max_results: {
            type: "number",
            description: "반환할 결과 수(기본 5, 최대 10)",
          },
          search_recency_filter: {
            type: "string",
            description: "시간 필터: hour, day, week, month, year. 시의성 질의에 사용.",
          },
        },
        required: ["query"],
      },
    },
  },
];

/** 게이트를 통과한 도구 선언만 반환 */
export function availableDeclarations(): FunctionDeclaration[] {
  return DECLARATIONS.filter((d) => d.gate()).map((d) => d.declaration);
}
