/**
 * 채팅 엔진 공유 타입 — React/Next 비의존 (dodo-planet 이식성).
 *
 * 모든 타입은 src/lib/types.ts에 정의된 도메인 타입을 재사용한다.
 * 후속 태스크(라우터·render 헬퍼·useChat·MessageBubble)가 전부 이 타입을 import한다.
 */

import type { Place, JusoAddress, WebSearchResult, JourneyResult } from "@/lib/types";

/** 응답 하단에 표시할 데이터 제공처. label은 i18n 키(chat.<label>), url은 선택. */
export interface SourceAttribution {
  label: string;
  url?: string;
}

/** 도구 실행 컨텍스트 — 각 도구 함수에 전달되는 공유 상태. */
export interface ExecutionContext {
  /** 사용자 현재 위치 (WGS84). 위치 권한 없으면 undefined. 길찾기 출발지로 쓴다. */
  userLocation?: { lat: number; lng: number };
  /**
   * 장소 컨텍스트 앵커 (WGS84 + 이름). 장소 상세에서 연 채팅일 때만 존재한다.
   * 주변/앰비언트 좌표 도구의 기준 좌표가 되며(I-1), userLocation을 덮어쓰지 않아
   * 길찾기 출발지는 현재 위치로 보존된다(I-2). 없으면 기존 동작(I-3).
   */
  placeAnchor?: { lat: number; lng: number; name: string };
  /**
   * 여정 도구(`plan_journey`, E70-b) 컨텍스트 — 클라이언트가 `"journey"` 능력을 신고했고 로케일이 ko일 때만 라우트가 싣는다.
   * **없으면 도구가 선언되지도 실행되지도 않는다**(닫힌 쪽이 기본값, D7).
   */
  journey?: {
    /** 요청 IP — 여정 Tmap 예산의 IP 버킷 키(D6). */
    clientIp: string;
    /** `userLocation`이 수동 지정 위치인가(D2) — 참이면 카드가 [안내 시작]을 내지 않는다. */
    manualOrigin: boolean;
    /**
     * 이 턴의 상태(D5). 요청마다 새 컨텍스트라 턴과 수명이 같다. 실행 진입 시 await 전에 동기로 갱신한다.
     * `asked`: 후보·동명 역을 돌려줘 되물어야 한다(이 턴엔 여정을 조회하지 않는다). `queried`: 여정을 이미 조회했다.
     */
    turn: { asked: boolean; queried: boolean };
  };
  /** UI 로케일 (ko|en|es|fr|it) */
  locale: string;
  /** 외부 데이터 언어 — dataLocale()로 파생 (ko|en) */
  dataLocale: "ko" | "en";
}

/**
 * 렌더 페이로드 — discriminated union (옵션 C: self-fetch 컴포넌트 파라미터 마운트).
 *
 * props-driven 변종(places·addresses): 데이터를 router가 가져와 전달.
 * self-fetch 변종 나머지: router는 파라미터만 추출하고 컴포넌트가 직접 fetch한다.
 */
export type RenderPayload =
  // props-driven 재사용 (데이터 그대로):
  // sort는 리뷰순(네이버 sort=comment)일 때만 실린다 — iOS 카드 묶음 헤딩이 "네이버 리뷰순
  // N곳"으로 갈리는 유일한 재료(낭독은 선형이라 헤딩이 곧 경계, spec 2026-08-17 §5.3).
  | { type: "places"; places: Place[]; sort?: "review" }
  | { type: "addresses"; results: JusoAddress[] }
  | { type: "web-results"; results: WebSearchResult[] }         // <WebResults results/>
  // self-fetch 컴포넌트 마운트 — 파라미터만 (컴포넌트가 직접 fetch):
  | { type: "subway-nearby" }                                   // <SubwayArrivalsNearby/>
  // ⚠ 아래 4종의 `places`는 웹 컴포넌트가 쓰지 않는다(self-fetch). iOS가 카드 대신
  // 산문 장소 언급 → 상세 진입의 근거로 쓴다(`nearby-place.ts` 투영, BACKLOG B9).
  | { type: "clinics-nearby"; places?: Place[] }                // <NightClinicsNearby/>
  | { type: "barrier-free-nearby"; places?: Place[] }           // <BarrierFreeNearby autoLoad/>
  | { type: "kids-nearby"; places?: Place[] }                   // <KidsPlacesNearby/>
  | { type: "surroundings-nearby"; places?: Place[] }           // <AroundNearby/> (둘러보기 패널, 2026-08-22 B9)
  | { type: "bus"; mode: "current" }
  | { type: "bus"; mode: "place"; lat: number; lng: number }    // <BusArrivals mode.../>
  | { type: "bike"; mode: "current" }
  | { type: "bike"; mode: "place"; lat: number; lng: number }   // <BikeStations mode.../>
  | { type: "air-quality"; lat: number; lng: number }           // <AirQuality lat lng/>
  | { type: "station-meta"; stationName: string }               // <StationMeta stationName/>
  | { type: "station-facilities"; stationName: string }         // <StationFacilities/> + <SeoulMetroFacilities/>
  | { type: "car-route"; dest: { lat: number; lng: number; name: string } }      // <CarRouteBriefing dest/>
  | { type: "transit-route"; dest: { lat: number; lng: number; name: string } } // <TransitRouteBriefing dest/>
  | JourneyRenderPayload;                                       // <JourneyChatCard/> (E70-b)

/** 채팅 요청이 신고할 수 있는 클라이언트 능력(E70-b D7). 모르는 값은 서버가 버린다. */
export type ChatCapability = "journey";

/** 여정에서 갈아탈 곳 하나 — 웹 `JourneyStationPick`과 같은 모양(React 비의존이라 여기서 다시 적는다). */
export interface JourneyChatStation {
  label: string;
  lat: number;
  lng: number;
  line?: string;
  kind?: "stop";
}

/**
 * 여정 카드(E70-b spec `2026-11-12-e70b-chat-journey-design.md` D8) — props-driven. 카드는 `result.variants[0]`과 첫 출구로
 * 제목·합계를 그리고, [안내 시작]은 `origin`·`queriedAt`으로 신선도(D16)를 본다. `manualOrigin`이면 [안내 시작]이 없다(D2).
 */
export interface JourneyRenderPayload {
  type: "journey";
  result: JourneyResult;
  origin: { lat: number; lng: number };
  /** 조회 시각(epoch ms). */
  queriedAt: number;
  manualOrigin: boolean;
  board: JourneyChatStation | null;
  alight: JourneyChatStation | null;
  dest: { lat: number; lng: number };
  destLabel: string;
  destRoman: string | null;
}

/** 도구 실행 결과 — LLM용 데이터 + 선택적 카드 + 출처. */
export interface ToolResult {
  /** LLM이 추론·종합할 실제 JSON (요약 문자열 아님). 실패 시 { error } */
  data: Record<string, unknown>;
  /** 구조화 데이터를 렌더할 카드 (없으면 텍스트만) */
  render?: RenderPayload;
  /** 이 도구가 사용한 데이터 제공처(0..n) */
  source?: SourceAttribution[];
}

/** 채팅 메시지 하나. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** 어시스턴트 응답에 첨부되는 카드들(복수 — 한 답변에 여러 카드 가능) */
  renders?: RenderPayload[];
  /** 응답 하단 출처 목록 */
  sources?: SourceAttribution[];
  error?: string;
}

/** NDJSON 스트리밍 이벤트 (서버 → 클라이언트, 1줄 1이벤트). */
export type ChatStreamEvent =
  | { type: "status"; categories: string[] }
  | { type: "done"; text: string; renders: RenderPayload[]; sources: SourceAttribution[] }
  | { type: "error"; code: string };
