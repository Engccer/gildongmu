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
  hasNaverLocalKeys,
} from "@/lib/env";

interface GatedDeclaration {
  /** 함수형은 호출 시점의 키 상태로 선언을 조립한다(인자 단위 게이트용). */
  declaration: FunctionDeclaration | (() => FunctionDeclaration);
  gate: () => boolean;
}

/**
 * search_places 선언. 도구의 존재는 카카오 키가, `sort` 인자는 네이버 키가 정한다 —
 * 게이트가 둘로 갈리는 것이 정상이다(spec 2026-08-17 §5.1). 두 키 중 하나만 있는 상태가
 * 실재하므로 하나로 합치면 死기능이나 호출 불가가 생긴다. 키가 없으면 인자 자체가 없어
 * LLM이 리뷰순을 부를 수 없다(서버 throw에 도달하지 않는다).
 */
function buildSearchPlacesDeclaration(): FunctionDeclaration {
  const properties: Record<string, unknown> = {
    query: { type: "string", description: "검색 키워드" },
  };
  if (hasNaverLocalKeys()) {
    properties.sort = {
      type: "string",
      enum: ["review"],
      description:
        "\"review\" — 네이버 카페·블로그 리뷰 '개수'가 많은 순. " +
        "⚠ 별점·평점·리뷰 수의 '값'은 제공되지 않는다(순서만). ⚠ 최대 5곳. " +
        "⚠ 좌표를 쓰지 않으므로 query에 지역명을 반드시 포함할 것(예: '길동 맛집').",
    };
  }
  return {
    name: "search_places",
    description:
      "키워드로 장소(상호·POI)를 검색한다. 예: '길동 카페', '강남역 맛집'. " +
      "사용자가 특정 지명/상호를 찾을 때 사용.",
    parametersJsonSchema: { type: "object", properties, required: ["query"] },
  };
}

/** 좌표 도구 공통 `place` 인자 — 지명을 주면 그 지명 기준, 없으면 보고 있는 장소 또는 현재 위치. */
const PLACE_ARG = {
  place: {
    type: "string",
    description: "지명(없으면 현재 위치 또는 보고 있는 장소 기준)",
  },
} as const;

const DECLARATIONS: GatedDeclaration[] = [
  { gate: hasKakaoKey, declaration: buildSearchPlacesDeclaration },
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
        "지하철 실시간 도착 정보를 보여준다. 역 이름을 말하면 stationName으로 그 역을, 지명이면 place 주변 역을, 둘 다 없으면 현재 위치 주변 역을 조회한다. " +
        "stationName 조회에서 arrivals가 null이면 그 역은 실시간 정보가 제공되지 않는 역이다(서울 도시철도 외) — 열차가 없다는 뜻이 아니다.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          stationName: { type: "string", description: "역 이름 (예: 천호, 강남)" },
          ...PLACE_ARG,
        },
      },
    },
  },
  {
    gate: hasDataGoKrKey,
    declaration: {
      name: "get_night_clinics",
      description:
        "현재 위치(또는 지명) 주변 소아 야간·휴일 진료 병원(달빛어린이병원)을 보여준다.",
      parametersJsonSchema: {
        type: "object",
        properties: PLACE_ARG,
      },
    },
  },
  {
    gate: hasKakaoKey,
    declaration: {
      name: "get_kids_places",
      description:
        "현재 위치(또는 지명) 주변 아이 놀 곳(키즈카페·놀이터·어린이공원)을 보여준다.",
      parametersJsonSchema: {
        type: "object",
        properties: PLACE_ARG,
      },
    },
  },
  {
    gate: hasSeoulOpenDataKey,
    declaration: {
      name: "get_nearby_events",
      description:
        "현재 위치(또는 지명) 주변에서 오늘 진행 중인 문화행사(전시·공연·체험 프로그램)를 거리순으로 보여준다. 서울 지역만 제공된다.",
      parametersJsonSchema: {
        type: "object",
        properties: PLACE_ARG,
      },
    },
  },
  {
    gate: hasKakaoKey,
    declaration: {
      name: "get_surroundings",
      description:
        "현재 위치(또는 지명) 주변 편의점·음식점·약국 등 주변 장소를 방위·거리와 함께 보여준다.",
      parametersJsonSchema: {
        type: "object",
        properties: PLACE_ARG,
      },
    },
  },
  {
    gate: hasKakaoKey,
    declaration: {
      name: "get_where_am_i",
      description:
        "현재 위치(또는 지명)가 어디인지 정위한다 — 도로명·지번 주소, 행정동, 1km 안 가장 가까운 지하철역(방위·거리), 주변 기준점. " +
        "사용자가 '여기가 어디야', '지금 내 위치', '주소 알려줘'처럼 자기 위치를 물을 때 호출한다.",
      parametersJsonSchema: { type: "object", properties: PLACE_ARG },
    },
  },
  {
    // 게이트 없음 — 대중교통 불릿은 정적 seed라 항상 있고, 나머지 불릿은 키 유무로 조립 안에서 가려진다.
    gate: () => true,
    declaration: {
      name: "get_nearby_overview",
      description:
        "현재 위치(또는 지명) 주변 1km를 한눈에 요약한다 — 대중교통(가까운 역·정류소), 식당, 카페, 아이 놀 곳, 오늘 문화행사, 무장애 관광지의 개수와 가장 가까운 곳 2~4곳씩(많을수록 더). " +
        "사용자가 '이 근처에 뭐가 있어', '주변 어때'처럼 특정 종류를 정하지 않고 전반을 물을 때 호출한다. 종류가 정해진 질문은 그 전용 도구를 쓴다. " +
        "불릿의 state가 failed면 조회 실패, none이면 1km 안에 없음, unavailable이면 그 지역엔 데이터가 없음이다 — 셋을 구분해 답하라.",
      parametersJsonSchema: { type: "object", properties: PLACE_ARG },
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
    gate: hasSeoulOpenDataKey,
    declaration: {
      name: "get_congestion",
      description:
        "현재 위치(또는 지명·보고 있는 장소)의 실시간 인구 혼잡도와 12시간 예보를 보여준다. 서울 주요 지역만 제공된다. 사용자가 붐비는 정도·사람이 많은지를 직접 묻거나 언제 가면 한산한지 물을 때만 호출한다.",
      parametersJsonSchema: {
        type: "object",
        properties: PLACE_ARG,
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
    gate: hasDataGoKrKey,
    declaration: {
      name: "get_station_timetable",
      description:
        "지하철역의 오늘 첫차·막차 시각을 노선·방향별로 보여준다(전국 도시철도). " +
        "timetable이 null이면 그 역의 시간표가 제공되지 않는 것이고, partial이 true면 일부 노선 조회가 실패해 불완전한 결과다 — 운행이 없다는 뜻으로 답하지 마라. dailyType은 조회 기준일(평일·토요일·일요일)이다. " +
        "lines[].coverage: ok=첫차·막차 있음 / unknown=그 노선의 오늘 시간표를 확인할 수 없음(운행이 없다는 뜻이 아니다) / unavailable=그 노선 조회 실패 / noTrains=오늘 탑승 가능한 편성 없음. 어떤 값이든 노선을 생략하지 말고 노선명과 함께 말하라.",
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
          via: {
            type: "string",
            description: "경유지 지명(한 곳). '~를 거쳐서', '~에 들렀다가' 같은 요청일 때만 넣는다.",
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
        "현재 위치(또는 지명·보고 있는 장소) 주변의 무장애 관광지(휠체어·점자블록·음성안내 등 장애인 편의시설을 갖춘 곳)를 보여준다. 각 항목의 contentId로 get_barrier_free_detail을 호출하면 편의시설 상세를 알 수 있다.",
      parametersJsonSchema: { type: "object", properties: PLACE_ARG },
    },
  },
  {
    gate: hasDataGoKrKey,
    declaration: {
      name: "get_barrier_free_detail",
      description:
        "무장애 관광지 한 곳의 장애인 편의시설 상세(주차·출입구·화장실·휠체어 대여·점자·음성안내 등)를 보여준다. " +
        "contentId는 get_nearby_barrier_free 결과의 contentId를 넣는다. detail이 null이면 항목이 없는 것이고, facilities가 비어 있으면 등록된 편의시설 정보가 없는 것이다.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          contentId: { type: "string", description: "get_nearby_barrier_free가 준 contentId" },
        },
        required: ["contentId"],
      },
    },
  },
  {
    gate: hasOdsayKey,
    declaration: {
      name: "get_transit_route",
      description:
        "목적지까지 대중교통(버스·지하철 환승) 경로를 출발 전 텍스트로 안내한다. 목적지를 destination에 넣는다(출발지는 현재 위치). " +
        "serviceStatus가 outside인 구간이 있으면 첫차·막차와 함께 지금은 운행하지 않는다고 알린다(running·unknown은 언급하지 않는다).",
      parametersJsonSchema: {
        type: "object",
        properties: {
          destination: {
            type: "string",
            description: "목적지 지명 또는 주소",
          },
          via: {
            type: "string",
            description: "경유지 지명. 대중교통은 경유지를 지원하지 않아 unsupported가 돌아온다 — 사용자가 경유를 요청했을 때만 넣어 그 사실을 전한다.",
          },
        },
        required: ["destination"],
      },
    },
  },
  {
    // 게이트 없음 - 음향신호기는 무인증 seed, OSM은 정적 seed(2026-08-16 전환)
    gate: () => true,
    declaration: {
      name: "get_walk_infrastructure",
      description:
        "현재 위치(또는 지명·보고 있는 장소) 주변 음향신호기·횡단보도·점자블록을 보여준다. " +
        "서울시·OpenStreetMap 등록 자료 기준이며, 실제 시설 유무나 작동 상태와 다를 수 있다.",
      parametersJsonSchema: { type: "object", properties: PLACE_ARG },
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
          via: {
            type: "string",
            description: "경유지 지명(한 곳). '~를 거쳐서', '~에 들렀다가' 같은 요청일 때만 넣는다.",
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
  return DECLARATIONS.filter((d) => d.gate()).map((d) =>
    typeof d.declaration === "function" ? d.declaration() : d.declaration,
  );
}
