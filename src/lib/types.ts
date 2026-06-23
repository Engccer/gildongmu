/**
 * 도메인 타입 정의.
 *
 * 좌표는 항상 WGS84 십진 도(decimal degrees)로 통일한다.
 * 네이버 지역 검색 API의 mapx/mapy(WGS84 × 10^7 정수)는
 * provider 계층에서 변환을 마친 뒤에만 이 타입으로 흘러나온다.
 */

import type { CompassDirection } from "./geo/bearing";

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
 * 행안부 도로명주소 검색(juso) 결과 하나 — provider가 응답을 정규화한 형태.
 * 라우트·컴포넌트는 juso 원본 필드를 모르고 이 shape로만 소통한다(이식성).
 */
export interface JusoAddress {
  /** 전체 도로명주소(참고항목 포함, 예 "서울특별시 중구 세종대로 110 (태평로1가)") */
  roadAddr: string;
  /** 도로명주소(참고항목 제외, 예 "서울특별시 중구 세종대로 110") */
  roadAddrPart1: string;
  /** 지번 주소 */
  jibunAddr: string;
  /** 공식 영문 주소(국가명 미포함, 예 "110 Sejong-daero, Jung-gu, Seoul") */
  engAddr: string;
  /** 우편번호(예 "04524") */
  zipNo: string;
  /** 건물명(없으면 "") */
  bdNm: string;
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

/** 대중교통 경로 한 구간(도보/버스/지하철). 고유명은 ODsay 한국어 원문 그대로. */
export interface TransitLeg {
  mode: "walk" | "bus" | "subway";
  /** "수도권 5호선" / "341" 등 ODsay 한국어 원문 (도보는 없음) */
  lineName?: string;
  /** 승차 정류장 (도보는 없음) */
  fromName?: string;
  /** 하차 정류장 (도보는 없음) */
  toName?: string;
  /** 정거장 수 (도보는 없음) */
  stationCount?: number;
  /** 구간 소요시간(분) */
  minutes: number;
}

/** 대중교통 경로 1개(요약 + 구간 리스트). */
export interface TransitRoute {
  summary: {
    totalMinutes: number;
    /** 요금(원) */
    fare: number;
    /** 환승 횟수 */
    transfers: number;
    /** 총 도보 시간(분) */
    walkMinutes: number;
    /** 첫 승차 정류장 (한국어 원문) */
    departName?: string;
    /** 막 하차 정류장 (한국어 원문) */
    arriveName?: string;
  };
  legs: TransitLeg[];
}

/** 대중교통 길찾기 결과: 추천 1개 + 대안 최대 2개. */
export interface TransitRouteResult {
  recommended: TransitRoute;
  alternatives: TransitRoute[];
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
  /** 저상버스 여부 — TAGO는 vehicletp "저상" 포함, 서울은 busType1 "1". 교통약자 정본 */
  lowFloor: boolean;
  /**
   * 완성된 도착 안내 문장(낭독 정본). 서울 TOPIS만 채운다(arrmsg1: "곧 도착",
   * "운행종료", "출발대기", "3분54초후[2번째 전]"). 서울은 traTime1이 운행종료에도
   * 비0을 줘 슬롯형(arrivalSeconds/prevStationCount)으로 환산하면 오발화하므로,
   * API가 준 완성 문장을 그대로 쓴다(SeoulSubwayArrival arvlMsg2 패턴 동형).
   * TAGO는 undefined → 컴포넌트가 기존 슬롯(route·type·prev·min) 렌더 유지.
   */
  arrivalMessage?: string;
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

/**
 * 진료시간 한 칸 — `start`/`end`는 HHMM 정수(예 1800, 2400=자정).
 * 해당 요일 진료시간 정보가 없으면 둘 다 null(=마감 아님, "정보 없음").
 */
export interface ClinicHours {
  start: number | null;
  end: number | null;
}

/** 진료 상태 3-state — "정보 없음(unknown)"과 "마감(closed)"을 뭉개지 않는다. */
export type ClinicOpenState = "open" | "closed" | "unknown";

/** 특정 요일·시각 기준 진료 상태(요청 시점 KST로 계산). */
export interface ClinicOpenStatus {
  state: ClinicOpenState;
  /** 그 요일 진료 시작/종료 HHMM(없으면 null). */
  start: number | null;
  end: number | null;
}

/**
 * 내 주변 소아 야간·휴일 진료 기관 하나 — NMC 15000736 달빛어린이병원·
 * 소아전문센터 목록(`getBabyListInfoInqire`) 정규화. 좌표 기반 "내 주변"의
 * 의료 안전망 정본(가짜 데이터 금지 — mock 폴백 없음).
 *
 * `hours`는 index 0..7 = 월·화·수·목·금·토·일·공휴일(dutyTime1..8 대응).
 * 진료 상태(지금 진료중 여부)는 요청 시점 KST에 의존하므로 타입에 박지 않고
 * 라우트가 `openStatus`(ClinicOpenStatus)를 계산해 덧붙인다.
 */
export interface NightClinic {
  /** 기관 ID(hpid) */
  id: string;
  /** 기관명(dutyName) */
  name: string;
  /** 주소(dutyAddr) */
  address: string;
  /** 대표 전화(dutyTel1) — 없으면 "" */
  phone: string;
  /** 기관 종별(dutyDivNam, 예 "의원"/"병원") */
  kind: string;
  /** 응급의료기관 분류명(dutyEmclsName, 예 "응급의료기관 이외") */
  emergencyClass: string;
  /** 찾아오는 길 안내(dutyMapimg, 예 "5호선 오목교역 2번 출구") — 없으면 "" */
  directions: string;
  lat: number;
  lng: number;
  /** 출발 좌표로부터 Haversine 거리(m). 좌표 비유한이면 Infinity(정렬 후미). */
  distanceMeters: number;
  /** 월~일·공휴일 진료시간(8칸, dutyTime1..8). */
  hours: ClinicHours[];
}

/**
 * 한 역에 도착 예정인 열차 하나 — 서울 지하철 실시간 도착(A2, OA-12764)
 * realtimeStationArrival 정규화. TAGO 미커버 도시철도의 실시간 정본.
 */
export interface SubwayArrival {
  /** 호선명(subwayId 코드 매핑, 예 "2호선","신분당선"). 미매핑 코드면 undefined. */
  line?: string;
  /** 상/하행 또는 내/외선(updnLine) */
  direction: string;
  /**
   * 행선 안내(trainLineNm) — 서울 지하철 표준상 "{종착역}행 - {주요경유}방면"
   * 완성 문구라 **종착역명을 포함**한다(예 "성수행 - 역삼방면"·"신사행 - 신논현방면").
   * 컴포넌트의 종착 정보 낭독 정본 — destination을 따로 표시하지 않아도 종착이 읽힌다.
   */
  trainLineNm: string;
  /** 종착역명(bstatnNm) — trainLineNm에 이미 포함되나 데이터 정합·필터용 보조 필드. */
  destination: string;
  /** 도착 메시지(arvlMsg2 — "강남 도착","3분 후(2번째 전)" — 낭독 정본) */
  message: string;
  /** 현재 위치(arvlMsg3, 예 "방배") */
  currentLocation?: string;
  /** 도착 예정(초, barvlDt). 0이면 진입/도착. */
  arrivalSeconds: number;
  /** 급행 여부(btrainSttus에 "급행" 포함) — 일반 열차와 구분 */
  express: boolean;
}

/**
 * 한 역의 실시간 도착 묶음. arrivals는 도착 임박 순(API 반환 순). 각 항목이
 * 노선·방향·방면·메시지로 자체완결하므로 컴포넌트는 **평면 리스트**로 표시한다 —
 * 환승역은 노선이 섞여(예 강남=2호선 외선 + 신분당선 상행) 방향만으로 묶으면
 * 외려 혼란스럽고, 항목별 자체완결이 스크린리더 순차 낭독에 더 명확(미니멀 접근성).
 */
export interface SubwayStationArrivals {
  /** 역명(statnNm 원문, "역" 접미사 없음) */
  stationName: string;
  /** 도착 열차들(API 반환 순 — 도착 임박 순) */
  arrivals: SubwayArrival[];
}

/**
 * 근접 지하철역 한 곳의 실시간 도착 — 홈 "내 주변 지하철 도착 정보"(A2) 진입점.
 *
 * 좌표→근접역(A3 정적 seed의 findStationsNear)→역별 실시간 도착을 합성한 결과.
 * 실시간 API가 역명 기반이라 버스/따릉이(좌표 직접)와 달리 seed 식별 한 단계가
 * 더 든다. BusStop.arrivalStatus와 동형으로 "조회 실패(unavailable) ≠ 도착 열차
 * 없음(ok·arrivals 빈 배열)"을 구분한다(시각장애인 정합 — 장애 은폐 금지).
 * 비서울 좌표는 seed 근접역이 잡혀도 swopenapi가 INFO-200 → 합성 단계에서 제외.
 */
export interface NearbySubwayStation {
  /** 역명(표시·낭독용, "역" 접미사 제거) */
  stationName: string;
  /** 영문 역명(A3 seed 메타 — 외국인 보조 표기, 없을 수 있음) */
  nameEn?: string;
  /** 이 역을 지나는 노선들(seed 메타 집계 — 환승역은 여럿) */
  lines: string[];
  /** 현재 위치로부터 Haversine 거리(m, 반올림) — 가까운 순 정렬 보존 */
  distanceMeters: number;
  /** 도착조회 상태 — "ok": 실시간 성공(arrivals 정본, 0건이면 정상적 "열차 없음").
   *  "unavailable": 실시간 실패(쿼터·인증·네트워크) → "열차 없음"과 구분, 장애 은폐 금지. */
  arrivalStatus: "ok" | "unavailable";
  /** 도착 열차들(arrivalStatus==="ok"일 때만 의미 — unavailable이면 []). */
  arrivals: SubwayArrival[];
}

/** 대기질 등급 — 1좋음·2보통·3나쁨·4매우나쁨, 부재/장애는 unknown(낭독 정본). */
export type AirGrade = "good" | "moderate" | "bad" | "veryBad" | "unknown";

/**
 * 오염물질 한 종(통합지수·미세먼지·초미세먼지)의 값+등급.
 * 측정 장애(*Flag) 또는 값/등급 부재 → value:null·grade:"unknown"
 * (측정 안 됨을 숫자로 노출 금지 — 시각장애인 오판 방지).
 */
export interface AirPollutant {
  /** 측정값(㎍/㎥ 또는 통합지수). 측정 장애·부재 → null */
  value: number | null;
  /** 등급(낭독 정본). 측정 장애·부재 → "unknown" */
  grade: AirGrade;
}

/**
 * 이 지역 공기질(B2) — 가장 가까운 측정소의 실시간 측정.
 *
 * WGS84→TM(EPSG:2097, proj4) 변환 후 근접 측정소 조회 → 측정소명 단건 실시간의
 * 2-call 체인 결과. 거리(`distanceKm`)는 에어코리아 API 정본(자체 Haversine 아님).
 * 등급이 1차 정보(낭독 정본), 수치는 보강. 측정 장애는 AirPollutant에서 unknown.
 */
export interface AirQuality {
  /** 측정소명 */
  stationName: string;
  /** 현재 위치로부터 거리(km, 에어코리아 `tm` 정본) */
  distanceKm: number;
  /** 측정소 주소 */
  addr: string;
  /** 측정 시각(예: "2026-06-17 19:00") */
  dataTime: string;
  /** 통합대기환경지수(KHAI) */
  khai: AirPollutant;
  /** 미세먼지(PM10) */
  pm10: AirPollutant;
  /** 초미세먼지(PM2.5) */
  pm25: AirPollutant;
}

/** 하늘상태 라벨 — 기상청 SKY 코드(1/3/4) 매핑. 미매핑 → unknown. */
export type SkyLabel = "clear" | "partlyCloudy" | "cloudy" | "unknown";

/** 강수형태 라벨 — 기상청 PTY 코드(0~4) 매핑. 미매핑 → unknown. */
export type PrecipLabel =
  | "none"
  | "rain"
  | "rainSnow"
  | "snow"
  | "shower"
  | "unknown";

/**
 * 이 지역 날씨 — 기상청 초단기실황(현재 실측) + 단기예보(하늘상태·최고최저·강수확률) 합성.
 *
 * 상태 단어(하늘상태/강수형태)가 낭독 정본, 수치는 보강. 부분 성공 가능
 * (실황만/예보만) — 없는 값은 null(해당 줄 생략). 둘 다 없으면 Weather 자체가 null.
 */
export interface Weather {
  /** 하늘상태(단기예보 SKY). 예보 부재 → label "unknown" */
  sky: { code: number | null; label: SkyLabel };
  /** 강수형태(초단기실황 PTY). 실황 부재 → label "unknown" */
  precipitation: { code: number | null; label: PrecipLabel };
  /** 현재기온(°C, 초단기실황 T1H). 부재 → null */
  tempC: number | null;
  /** 일 최고기온(단기예보 TMX, 오늘분). 부재 → null */
  tempMax: number | null;
  /** 일 최저기온(단기예보 TMN, 오늘분). 부재 → null */
  tempMin: number | null;
  /** 습도(%, 초단기실황 REH). 부재 → null */
  humidity: number | null;
  /** 강수확률(%, 단기예보 POP). 부재 → null */
  precipProbability: number | null;
  /** 조회 기준 시각 "HH:mm"(실황 base_time). 낭독 "조회시각" */
  baseTime: string;
  /** 기상청 격자(디버그·캐시 키) */
  grid: { nx: number; ny: number };
}

/** 키즈 장소 종류(B3). 카카오 category_name 계층에서 결정적 분류. */
export type KidsPlaceKind = "kidscafe" | "playground" | "playcenter" | "park";

/**
 * 실내/실외(B3 우천 판단 정보). 놀이터는 모호해 이름 신호 없으면 unknown —
 * 잘못된 단정 금지(B1·B2 unknown 교훈). 라벨이 1차 정보, 자동필터는 V1 비포함.
 */
export type IndoorOutdoor = "indoor" | "outdoor" | "unknown";

/**
 * 근처 아이 놀 곳(B3) — 카카오 로컬 좌표 근접 검색 결과 1건.
 *
 * ⚠ 키워드 매칭 ≠ 키즈 장소: category_name 계층 화이트리스트로 거짓양성
 * (스킨스쿠버·노인복지시설·동우회·방탈출카페 등)을 차단한 뒤의 정규화 결과.
 * 거리는 카카오 `distance`(m) 정본(x/y 제공 시 채워짐). 좌표는 WGS84 그대로.
 */
export interface KidsPlace {
  /** 카카오 장소 id(dedupe 키, "kakao-" 접두) */
  id: string;
  name: string;
  /** 카카오 category_name 전체 계층 */
  category: string;
  kind: KidsPlaceKind;
  indoorOutdoor: IndoorOutdoor;
  /** 현재 위치로부터 거리(m, 카카오 정본) */
  distanceMeters: number;
  address: string;
  roadAddress?: string;
  lat: number;
  lng: number;
  phone?: string;
  /** 카카오맵 상세 페이지 */
  link?: string;
}

/** 내 주변 둘러보기(기능 A) 카테고리 — 카카오 category_group_code 매핑. */
export type SurroundingCategory =
  | "convenience"
  | "subway"
  | "restaurant"
  | "cafe"
  | "bank"
  | "pharmacy"
  | "hospital"
  | "mart"
  | "public"
  | "attraction";

/**
 * 내 주변 둘러보기 결과 1건 — 카카오 카테고리 검색 좌표 근접.
 * 거리는 카카오 `distance`(m) 정본, 방향은 두 좌표 간 북 기준 8방위(우리가 산출).
 */
export interface SurroundingPlace {
  id: string;
  name: string;
  category: SurroundingCategory;
  /** 카카오 category_name 전체 계층(보조 표시) */
  categoryRaw: string;
  distanceMeters: number;
  bearing: CompassDirection;
  lat: number;
  lng: number;
  phone?: string;
  link?: string;
}

/**
 * 웹 검색 결과 1건 — Perplexity Search API 정규화.
 * 채팅 LLM이 산문에 종합하고, web-results 카드로 출처 링크를 노출한다.
 */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  date: string | null;
}
