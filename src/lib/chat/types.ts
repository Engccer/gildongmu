/**
 * 채팅 엔진 공유 타입 — React/Next 비의존 (dodo-planet 이식성).
 *
 * 모든 타입은 src/lib/types.ts에 정의된 도메인 타입을 재사용한다.
 * 후속 태스크(라우터·render 헬퍼·useChat·MessageBubble)가 전부 이 타입을 import한다.
 */

import type { Place, JusoAddress } from "@/lib/types";

/** 응답 하단에 표시할 데이터 제공처. label은 i18n 키(chat.<label>), url은 선택. */
export interface SourceAttribution {
  label: string;
  url?: string;
}

/** 도구 실행 컨텍스트 — 각 도구 함수에 전달되는 공유 상태. */
export interface ExecutionContext {
  /** 사용자 현재 위치 (WGS84). 위치 권한 없으면 undefined. */
  userLocation?: { lat: number; lng: number };
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
  | { type: "places"; places: Place[] }
  | { type: "addresses"; results: JusoAddress[] }
  // self-fetch 컴포넌트 마운트 — 파라미터만 (컴포넌트가 직접 fetch):
  | { type: "subway-nearby" }                                   // <SubwayArrivalsNearby/>
  | { type: "clinics-nearby" }                                  // <NightClinicsNearby/>
  | { type: "kids-nearby" }                                     // <KidsPlacesNearby/>
  | { type: "surroundings-nearby" }                             // <SurroundingsNearby/>
  | { type: "bus"; mode: "current" }
  | { type: "bus"; mode: "place"; lat: number; lng: number }    // <BusArrivals mode.../>
  | { type: "bike"; mode: "current" }
  | { type: "bike"; mode: "place"; lat: number; lng: number }   // <BikeStations mode.../>
  | { type: "air-quality"; lat: number; lng: number }           // <AirQuality lat lng/>
  | { type: "station-meta"; stationName: string }               // <StationMeta stationName/>
  | { type: "station-facilities"; stationName: string }         // <StationFacilities/> + <SeoulMetroFacilities/>
  | { type: "car-route"; dest: { lat: number; lng: number; name: string } }      // <CarRouteBriefing dest/>
  | { type: "transit-route"; dest: { lat: number; lng: number; name: string } }; // <TransitRouteBriefing dest/>

/** 도구 실행 결과 — 텍스트 요약 + 선택적 렌더 페이로드. */
export interface ToolResult {
  /** 어시스턴트 메시지에 포함될 텍스트 요약 */
  summary: string;
  /** 구조화 데이터를 렌더할 때 첨부 (없으면 텍스트만) */
  render?: RenderPayload;
}

/** 채팅 메시지 하나 — 사용자 발화 또는 어시스턴트 응답. */
export interface ChatMessage {
  /** 메시지 고유 식별자 */
  id: string;
  /** 발화자 역할 */
  role: "user" | "assistant";
  /** 표시 텍스트 */
  text: string;
  /** 어시스턴트 응답에 첨부되는 렌더 페이로드 (없으면 텍스트만) */
  render?: RenderPayload;
  /** 오류 발생 시 오류 메시지 */
  error?: string;
}
