/**
 * 도메인 타입 정의.
 *
 * 좌표는 항상 WGS84 십진 도(decimal degrees)로 통일한다.
 * 네이버 지역 검색 API의 mapx/mapy(WGS84 × 10^7 정수)는
 * provider 계층에서 변환을 마친 뒤에만 이 타입으로 흘러나온다.
 */

/** 장소 하나. 모든 provider의 응답이 이 형태로 정규화된다. */
export interface Place {
  /** provider 내부 식별자 (없으면 name+주소 해시) */
  id: string;
  /** 업체/장소 이름 (HTML 태그 제거된 평문) */
  name: string;
  /** 카테고리 경로 (예: "음식점>한식") */
  category: string;
  /** 지번 주소 */
  address: string;
  /** 도로명 주소 */
  roadAddress: string;
  /** 영문 주소 (en 로케일에서 NCP geocoding으로 보강 — 없을 수 있음) */
  englishAddress?: string;
  /** 위도 (WGS84) */
  lat: number;
  /** 경도 (WGS84) */
  lng: number;
  /** 전화번호 (없을 수 있음) */
  phone?: string;
  /** 홈페이지 등 링크 (없을 수 있음) */
  link?: string;
  /**
   * 현재 위치 기준 거리(m) — 클라이언트가 geolocation으로 정렬할 때만 부여한다
   * (sortPlacesByDistance). provider 응답에는 없으며, 위치 권한이 없으면 미설정.
   */
  distanceMeters?: number;
}

/** 장소 검색 요청 파라미터 */
export interface PlaceSearchParams {
  query: string;
  /** 결과 개수 (카카오 로컬 단일 요청 최대 15, 네이버 지역 검색은 최대 5) */
  limit?: number;
  /** UI 로케일 — 다국어 provider(TourAPI) 선택에 사용 */
  lang?: "ko" | "en";
}

/** 장소 검색 결과 + 메타데이터 */
export interface PlaceSearchResult {
  places: Place[];
  /** 어떤 provider가 응답했는지 — UI에서 mock 모드 안내에 사용 */
  provider: "mock" | "naver-local" | "kakao-local" | "tour-api" | "merged";
  query: string;
}

/** 길찾기 이동 수단 (네이버 지도 앱 딥링크 actionPath와 1:1 대응) */
export type RouteMode = "walk" | "public" | "car" | "bike";

/** 딥링크 생성에 필요한 출발/도착 정보 */
export interface RouteEndpoints {
  start?: { lat: number; lng: number; name: string };
  dest: { lat: number; lng: number; name: string };
}

/** 좌표 한 점 (WGS84) */
export interface Coord {
  lat: number;
  lng: number;
}

/**
 * 주소 검색(지오코딩) 결과 하나.
 * 카카오 로컬 주소 검색 응답을 정규화한 형태 — 도로명/지번 중
 * 존재하는 것만 채워진다.
 */
export interface AddressMatch {
  /** 입력 그대로의 대표 주소 문자열 */
  addressName: string;
  /** 도로명 주소 (없을 수 있음) */
  roadAddress?: string;
  /** 지번 주소 (없을 수 있음) */
  jibunAddress?: string;
  /** 우편번호 (도로명 주소가 있을 때만) */
  postalCode?: string;
  lat: number;
  lng: number;
}

/**
 * 자동차 경로의 턴바이턴 안내 한 단계.
 * guidance는 provider(카카오모빌리티)가 완성해 주는 한국어 안내문 —
 * 스크린 리더 낭독의 정본 텍스트로 그대로 사용한다.
 */
export interface CarRouteGuide {
  /** 교차로/지점 이름 (없으면 빈 문자열) */
  name: string;
  /** 안내 문구 (예: "염천교에서 서대문역 방면으로 좌회전") */
  guidance: string;
  /** 이 안내 지점까지의 구간 거리 (m) */
  distanceMeters: number;
  /** 이 안내 지점까지의 구간 소요 시간 (초) */
  durationSeconds: number;
}

/**
 * 역 교통약자 편의시설 — 지도 없이 완결되는 접근성 정보 정본.
 *
 * 한국철도공사(B551457) API 두 엔드포인트를 조인한 결과:
 * - weekPersonFacilities(교통약자): 장애인 화장실·휠체어 리프트·장애인 경사로
 * - stationFacilities: 엘리베이터 수
 * 데이터 모집단은 전국 철도역(KTX·일반철도, 406역)이며 도시철도(지하철)는
 * 별도 사업자라 포함되지 않는다 — 미커버 역은 null로 graceful degrade.
 */
export interface StationFacilities {
  /** 역명(데이터셋 표기 그대로, 표시용) */
  stationName: string;
  /** 장애인 화장실 유무 (pwdbs_tolt_estnc) */
  accessibleToilet: boolean;
  /**
   * 휠체어 리프트 수 (whlch_liftt_cnt).
   * undefined = 정보 없음(파싱 불가/빈값). "0대"와 명확히 구분한다.
   */
  wheelchairLifts: number | undefined;
  /** 장애인 경사로/통로 유무 (pwdbs_slwy_estnc) */
  accessibleSlope: boolean;
  /**
   * 엘리베이터 수 (stationFacilities elevt_cnt).
   * undefined = 정보 없음(보조 데이터 부재/실패). "0대"와 구분한다.
   */
  elevators: number | undefined;
}

/** 서울 지하철 교통약자 시설 종류 키 — i18n 라벨·그룹핑용. */
export type SeoulMetroFacilityKind =
  | "elevator"
  | "escalator"
  | "wheelchairLift"
  | "movingWalk"
  | "wheelchairCharger"
  | "safetyPlatform"
  | "signLangPhone"
  | "helper"
  | "restroom";

/** 시설 인스턴스 하나(엘리베이터 1대 등) — 위치·층·가동현황을 낭독 정본으로 보존. */
export interface SeoulMetroFacility {
  /** 시설명(fcltNm) 예: "승강기)엘리베이터-강동 내부 1호기" */
  name: string;
  /** 상세 위치 — dtlPstn 또는 시설별 위치 필드. 없으면 undefined. */
  location: string | undefined;
  /** 층 정보 — "지하3층~지하4층" 등. 해당 없으면 undefined. */
  floors: string | undefined;
  /** 가동현황 — 엘리베이터·에스컬레이터만. M=normal, 그 외=stopped, 필드 없으면 undefined. */
  operatingStatus: "normal" | "stopped" | undefined;
  /** 시설별 보조 설명(화장실 종류·휠체어 접근 등). 없으면 undefined. */
  detail: string | undefined;
}

/** 한 시설 종류의 묶음 — 데이터가 있는 종류만 포함된다. */
export interface SeoulMetroFacilityGroup {
  kind: SeoulMetroFacilityKind;
  facilities: SeoulMetroFacility[];
}

/** 한 지하철역의 교통약자 시설 전체(서울교통공사 1~8호선). */
export interface SeoulMetroFacilities {
  /** 역명(데이터셋 표기, 표시용) */
  stationName: string;
  /** 호선(첫 매칭 항목 기준) — 없으면 undefined */
  line: string | undefined;
  /** 데이터가 있는 시설 종류만. 전부 비면 빈 배열 → 라우트가 null 처리. */
  groups: SeoulMetroFacilityGroup[];
}

/** 자동차 경로 텍스트 브리핑 — 지도 없이 완결되는 경로 정보의 정본 */
export interface CarRouteBriefing {
  distanceMeters: number;
  durationSeconds: number;
  /** 예상 택시 요금 (원) */
  taxiFare: number;
  /** 통행 요금 (원) */
  tollFare: number;
  guides: CarRouteGuide[];
}

/** 버스 정보 제공자 — 병합 후 정류소/노선이 어느 API 소속인지 구분(라우트 디스패치 키). */
export type BusSource = "tago" | "seoul";

/**
 * 버스 정류소 하나 — TAGO 근접정류소(A-2) + 도착예정(A-1) + 계산 거리.
 * 좌표는 WGS84 십진 도. nodeId·cityCode는 도착(A-1)·경유정류소(A-3) 조회 키.
 */
export interface BusStop {
  nodeId: string;
  cityCode: string;
  /** 정류소명(한글 — TAGO는 영문 미제공) */
  name: string;
  /** 정류소 표지판 번호(없을 수 있음) */
  stopNo?: string;
  lat: number;
  lng: number;
  /** 출발 좌표로부터 Haversine 거리(m) — 정렬·표시용 */
  distanceMeters: number;
  /** 제공자 — "tago"(경기·지방·부산) | "seoul"(서울 TOPIS). 경유정류소 조회 디스패치에 사용. */
  source: BusSource;
  /** 도착조회 상태(개정 노트 §1) — "ok": A-1 성공(arrivals 정본, 0건이면 정상적 "버스 없음").
   *  "unavailable": A-1 실패(쿼터·인증·네트워크) → "버스 없음"과 구분, 장애 은폐 금지. */
  arrivalStatus: "ok" | "unavailable";
  /** 도착 예정 버스(도착 임박 순). arrivalStatus==="ok"일 때만 의미 — unavailable이면 []. */
  arrivals: BusArrival[];
}

/** 정류소에 도착 예정인 버스 하나 — TAGO 도착정보(A-1) 정규화. */
export interface BusArrival {
  /** 노선 ID — 경유정류소(A-3) 조회 키 */
  routeId: string;
  /** 노선번호(예 "272") */
  routeNo: string;
  /** 노선유형(한글, 예 "간선버스") */
  routeType: string;
  /** 도착 예정(초) */
  arrivalSeconds: number;
  /** 남은 정류장 수 */
  prevStationCount: number;
  /** 저상버스 여부(vehicletp에 "저상" 포함) — 교통약자 정본 */
  lowFloor: boolean;
  /** 제공자 — 경유정류소 조회를 올바른 provider로 보내는 키. */
  source: BusSource;
}

/** 노선 경유정류소 하나 — TAGO 노선정보(A-3) 정규화. */
export interface BusRouteStop {
  nodeId: string;
  name: string;
  /** 정류소 순번(nodeord) */
  order: number;
  lat: number;
  lng: number;
}

/**
 * 도시철도역 하나 — 전국도시철도역사정보 표준데이터(A3) 정적 seed의 한 행.
 *
 * 1,098개 도시철도역의 한/영(/한자) 역명 + WGS84 좌표 + 노선·환승·주소.
 * OpenAPI가 아니라 연 1회 갱신 XLSX라 정적 seed로 번들한다(서버 전용 import).
 * A1(역 교통약자 시설)·A2(실시간 도착)의 역 식별·영문 역명·좌표 근접 받침대.
 * 같은 역명이 노선마다 별도 레코드라, 환승역은 여러 행으로 나온다(고속터미널 3행).
 */
export interface SubwayStation {
  /** 역번호(원문 int/str 혼합 → 문자열 통일, 예 "0350","S112") */
  stationId: string;
  /** 역사명(원문, 예 "고속터미널" — "역" 접미사는 있는 역/없는 역 혼재) */
  name: string;
  /** 영문 역명(표준데이터 100% 제공, 외국인 en 정합 정본) */
  nameEn: string;
  /** 노선명(예 "3호선","우이신설선") */
  lineName: string;
  /** 위도(WGS84, 소수 6자리) */
  lat: number;
  /** 경도(WGS84, 소수 6자리) */
  lng: number;
  /** 운영기관명(예 "서울교통공사","한국철도공사") */
  operator: string;
  /** 역사 도로명주소 */
  roadAddress: string;
  /** 환승역 여부(환승역구분 === "환승역") */
  isTransfer: boolean;
  /** 한자 역명(일부 역 누락 가능) */
  nameHanja?: string;
  /** 환승 노선 설명(원문, 일반역은 없음) */
  transferLines?: string;
}

/**
 * 한 역의 메타 요약(A3) — 같은 역명의 여러 노선 레코드를 하나로 집계.
 * 장소 상세에서 역일 때 영문역명·노선·환승을 표시하는 표시용 정본.
 * 환승역은 노선이 여럿이라 lines로 묶고, isTransfer는 어느 한 행이라도 환승이면 true.
 */
export interface StationMeta {
  /** 한글 역명(대표, 모든 노선 행에서 동일) */
  name: string;
  /** 영문 역명(외국인 en 정합 정본) */
  nameEn: string;
  /** 한자 역명(있으면) */
  nameHanja?: string;
  /** 이 역명을 지나는 노선들(중복 제거, 원문 순서 보존) */
  lines: string[];
  /** 환승역 여부 */
  isTransfer: boolean;
  /** 운영기관명(대표, 첫 행 기준) */
  operator: string;
}

/**
 * 따릉이(서울 공공자전거) 대여소 하나 — bikeList(OA-15493) 정규화 + 계산 거리.
 * 좌표는 WGS84 십진 도. 서울 전용(따릉이는 서울시 운영).
 */
export interface BikeStation {
  /** 대여소 ID(예 "ST-2749") */
  stationId: string;
  /** 대여소명 — 원문 그대로(번호 접두 포함, 예 "3681. 길동 마루빌딩") */
  name: string;
  lat: number;
  lng: number;
  /** 출발 좌표로부터 Haversine 거리(m). 좌표 비유한이면 Infinity(정렬 후미). */
  distanceMeters: number;
  /** 거치대 총수(rackTotCnt) */
  racksTotal: number;
  /** 대여 가능 자전거 수(parkingBikeTotCnt) */
  bikesAvailable: number;
}
