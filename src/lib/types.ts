/**
 * 도메인 타입 정의.
 *
 * 좌표는 항상 WGS84 십진 도(decimal degrees)로 통일한다.
 * 네이버 지역 검색 API의 mapx/mapy(WGS84 × 10^7 정수)는
 * provider 계층에서 변환을 마친 뒤에만 이 타입으로 흘러나온다.
 */

import type { CarAction } from "./car-action";
import type { GuideAction } from "./walk-action";
import type { CompassDirection } from "./geo/bearing";
import type { FinalApproachGeometry } from "./final-approach";

/** 장소 하나. 모든 provider의 응답이 이 형태로 정규화된다. */
export interface Place {
  /** provider 내부 식별자 (없으면 name+주소 해시) */
  id: string;
  /** 업체/장소 이름 (HTML 태그 제거된 평문) */
  name: string;
  /**
   * 이름의 로마자(국어원 표기법, 서버 `romanize.ts`, E28). 한글이 있는 이름에만 실리고
   * 영문 원천 이름(TourAPI en 등)에는 없다. 비-ko 로케일이 `Roman (한글)` 병기에 쓴다.
   */
  nameRoman?: string;
  /** 카테고리 경로 (예: "음식점>한식") */
  category: string;
  /**
   * 카카오 분류 경로의 영문(A28, additive, `kakao-category.ts`). 세그먼트 전부 등재일 때만 실리고
   * 하나라도 미등재면 부재 — 비-ko 표시는 `pickCategory`가 원문으로 폴백한다. 판정 축은 `category`.
   */
  categoryEn?: string;
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
   * 현재 위치 기준 거리(m) — searchPlaces가 좌표 파라미터 존재 시 표기용으로만
   * 부여한다(annotateDistances, 정렬 축 아님). 위치 권한이 없으면 미설정.
   */
  distanceMeters?: number;
}

/** 장소 검색 요청 파라미터 */
/** 장소 검색 정렬 축. review = 네이버 지역검색 sort=comment(카페·블로그 리뷰 '개수'순 —
 * 값 없음·최대 5건·좌표 무시, spec 2026-08-17-naver-review-sort). */
export type PlaceSort = "accuracy" | "review";

export interface PlaceSearchParams {
  query: string;
  /** 결과 개수 (카카오 로컬 단일 요청 최대 15, 네이버 지역 검색은 최대 5) */
  limit?: number;
  /** UI 로케일 — 다국어 provider(TourAPI) 선택에 사용 */
  lang?: "ko" | "en";
  /** 검색 기준 좌표(WGS84). 있으면 카카오가 근접성을 정확도에 블렌딩하고, 결과에 distanceMeters를 표기한다(정렬 축 아님). */
  lat?: number;
  lng?: number;
  /** 미지정=accuracy(기존 동작과 바이트 동일). review는 네이버 단독 — 병합·거리 재정렬 없음. */
  sort?: PlaceSort;
}

/** 장소 검색 결과 + 메타데이터 */
export interface PlaceSearchResult {
  places: Place[];
  /** 어떤 provider가 응답했는지 — UI에서 mock 모드 안내에 사용. "none"은 게이트가
   * 소스 키 부재로 빈 결과를 반환한 死기능 0 상태(라우트 빈 응답과 동일 의미). */
  provider: "mock" | "naver-local" | "kakao-local" | "tour-api" | "merged" | "none";
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
  /**
   * 측위 정확도(m). 수동 위치의 이동 판정이 오차 원을 차감하는 데 쓴다
   * (`effective-location.ts`). 기존 소비자는 읽지 않으므로 선택적이다.
   */
  accuracy?: number;
  /**
   * fix **취득 시각**(epoch **초**). 나이 기준 재취득이 이 값을 읽는다
   * (`geolocation.ts`의 `maxAgeSeconds`). 단위를 밀리초로 섞으면 나이가 1000배로
   * 어긋나 재취득이 영영 걸리지 않으므로, 초로 통일한다(`ManualFix.at`과 같은 단위).
   *
   * 없을 수 있다(저장된 구 좌표·수기 조립분). **없으면 "나이 불명"이고 신선하지
   * 않은 것으로 본다** — 나이 없는 캐시를 신선으로 치면 수명 무한이던 종전 동작으로
   * 되돌아간다(Kit `isCacheFresh` 계약과 같은 방향).
   */
  at?: number;
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
 * guidance는 provider(Tmap 기본·카카오 폴백)의 완성 한국어 안내문을 서버가
 * 재작성한 낭독 정본이다(`rewriteCarGuidance` — `getCarRoute` 진입점에서 적용).
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
  /**
   * 이 안내 지점의 동작 이후 구간 폴리라인(B1 실시간 자동차 안내 옵트인 —
   * `includeGeometry=1`일 때만 존재, 미지정 응답은 키 자체가 없다).
   */
  pathCoords?: Coord[];
  /** 구간을 구성하는 링크별 도로명·길이(무명 링크는 name null — "일반도로" 가짜 정밀 금지). */
  roadLinks?: { name: string | null; distanceMeters: number }[];
  /**
   * 이 지점의 결정 행동(Tmap `turnType` 투영, `carActionFromTurnType`). 기하 옵트인 전용이고
   * 행동 없는 지점(직진·터널·톨게이트…)은 키 자체가 없다 — 임박 큐는 침묵. 카카오 폴백엔 없다.
   * spec `2026-08-23-car-guidance-completion-design.md` §2.
   */
  action?: CarAction;
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

/** 서울 지하철 교통약자 시설 종류 키(서울교통공사 wksn 9종) — i18n 라벨·그룹핑용. */
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

/**
 * 시설 패널 그룹 종류 — wksn 9종 + 보강 그룹 2종(음성유도기·엘리베이터 위치 폴백).
 * 보강 그룹은 wksn과 무관한 별도 데이터 소스(정적 seed·OA-21212)라 원본
 * SeoulMetroFacilityKind에 섞지 않고 그룹 레벨에서만 합류시킨다.
 */
export type SeoulMetroFacilityGroupKind = SeoulMetroFacilityKind | "voiceGuide" | "elevatorLocation";

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
  /**
   * 서버가 합성한 한국어(`name`·`detail`)의 **구조화 원재료**(A26, 2026-08-31). 비-ko 클라이언트가
   * 자기 언어로 조립한다(웹 `metroFacilityGroups` ↔ iOS `StationSections`). 문자열 필드는 불변
   * (CLI/MCP 계약). 어느 필드가 오는지는 그룹 종류가 정한다 — voiceGuide: `location`(+환승역만
   * `line`), restroom: `restroomType`·`wheelchairAccessible`, elevatorLocation: `compass`·`meters`·`dong`.
   * 구버전 응답엔 없다(부재면 문자열 필드 그대로).
   */
  parts?: SeoulMetroFacilityParts;
}

/** `SeoulMetroFacility.parts` — 그룹 종류별로 쓰는 필드가 다르다(위 주석). */
export interface SeoulMetroFacilityParts {
  /** voiceGuide: 위치 원문(서울교통공사 표기). */
  location?: string;
  /** voiceGuide: 환승역에서만 오는 노선 번호(예 "5" — "호선"은 클라이언트가 단다). */
  line?: string;
  /**
   * `line`의 영문 노선명(`lang=en`에만, E27 표 `subwayLineNameEn` — 예 "Line 5"). 표 미스면 부재이고
   * 소비자는 종전대로 `line`에 자기 언어 접미를 단다. 웹은 표를 직접 타므로 이 필드는 iOS 몫이다.
   */
  lineEn?: string;
  /** restroom: 화장실 종류 원문(rstrmInfo). */
  restroomType?: string;
  /** restroom: 휠체어 접근 가능(whlchrAcsPsbltyYn === "Y")일 때만. */
  wheelchairAccessible?: true;
  /** elevatorLocation: 역 중심 기준 8방위. */
  compass?: "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
  /** elevatorLocation: 역 중심 기준 거리(m, 10m 반올림). */
  meters?: number;
  /** elevatorLocation: 법정동명(있을 때만). */
  dong?: string;
}

/** 한 시설 종류의 묶음 — 데이터가 있는 종류만 포함된다. */
export interface SeoulMetroFacilityGroup {
  kind: SeoulMetroFacilityGroupKind;
  facilities: SeoulMetroFacility[];
}

/** 한 지하철역의 교통약자 시설 전체(서울교통공사 1~8호선 + 보강 그룹). */
export interface SeoulMetroFacilities {
  /** 역명(데이터셋 표기, 표시용) */
  stationName: string;
  /** 호선(첫 매칭 항목 기준) — 없으면 undefined */
  line: string | undefined;
  /**
   * 데이터가 있는 시설 종류만. 전부 비고 supplementFailed도 없으면 provider가
   * null을 반환(라우트가 그대로 전달). ⚠ groups가 빈 배열이어도 supplementFailed
   * true면 이 객체 자체는 non-null — 보강 실패 사실을 은폐하지 않기 위함(스펙 §2-C).
   */
  groups: SeoulMetroFacilityGroup[];
  /**
   * 보강 소스(OA-21212 엘리베이터 위치 폴백) 실패 시 true — wksn 주 조회는
   * 정상이었지만 보강만 실패했을 때만 표기한다. 실패 은폐 금지(스펙 §2-C).
   * groups가 전멸(빈 배열)이어도 이 플래그가 있으면 null을 반환하지 않는다.
   */
  supplementFailed?: true;
}

/** 자동차 경로 텍스트 브리핑 — 지도 없이 완결되는 경로 정보의 정본 */
/**
 * 경유지 도착 지점(N4, spec 2026-08-22 §2.2). `via`를 받은 요청에만 존재한다.
 * `steps[stepIndex]`(자동차는 `guides[stepIndex]`)가 경유지에서 시작하는 첫 안내
 * 단계이고, `coord`는 provider가 보행로·도로 위로 스냅한 경유 지점이다.
 * 스텝 문장은 손대지 않는다 — 소비자가 이 인덱스 자리에 자기 라벨로 구획을 그린다.
 */
export interface RouteWaypoint {
  stepIndex: number;
  coord: Coord;
}

export interface CarRouteBriefing {
  distanceMeters: number;
  durationSeconds: number;
  /** 예상 택시 요금 (원) */
  taxiFare: number;
  /** 통행 요금 (원) */
  tollFare: number;
  guides: CarRouteGuide[];
  /**
   * ko 서비스 provider 판별자(B1 §3.1 — 자동차 안내 버튼 게이트). 카카오 폴백
   * 응답은 기하 미지원이라 클라이언트가 이 값으로 버튼을 내지 않는다.
   * en(NCP) 경로는 미설정.
   */
  provider?: "tmap" | "kakao";
  /**
   * 안내문(`guides[].guidance`)의 언어(A26, 2026-08-31). `lang=en` 요청도 NCP 키 부재·경유지
   * (`via`)면 ko 서비스로 폴백하는데(N4의 의도된 결정 — 조용히 버리는 것보다 한국어 문장이
   * 낫다), 그 사실을 응답이 말하지 않으면 en 화면이 한국어 문장을 영어 엔진으로 읽는다.
   * 소비자는 `"ko"`면 그 텍스트 블록에 `lang="ko"`를 단다. 구버전 서버 응답엔 없다.
   */
  guidanceLang?: "ko" | "en";
  /**
   * 종점(E) 마커 좌표(기하 옵트인 전용, B1 §5). 마지막 스텝의 끝이 이 좌표와
   * 어긋나면 경로가 조용히 짧게 조립된 것 — buildCarGuide가 fail-closed 검증한다.
   */
  terminalCoord?: Coord;
  /** 경유지(`via` 요청 시에만, N4). */
  waypoint?: RouteWaypoint;
}

/**
 * 대중교통 경로의 경유 정류장·역 하나(ODsay passStopList 정규화, B2 §7).
 * `includeStops=1` 옵트인 시에만 탑승 leg에 실린다.
 */
export interface TransitLegStop {
  name: string;
  /**
   * ODsay 내부 ID 원문 문자열. 수도권 지하철은 4자리 zero-pad 시 seed
   * stationId와 일치(프로브 2026-08-04 — 단 부산·대구와 충돌하므로 조인은
   * ID ∧ 정규화 역명 이중 게이트).
   */
  stationId?: string;
  /** 지역 정류소 ID(버스 localStationID — 서울은 TOPIS stId 동일값, 조사 §1.1) */
  localId?: string;
  /** 정류소 고유번호(버스 arsID — 서울 getStationByUid 조회 키) */
  arsId?: string;
  /**
   * ODsay 정류소 도시 코드 원문(stationCityCode, 서울=1000). TOPIS 추적 가능
   * 판정 축 — arsID·localStationID는 지방 BIS도 채울 수 있어 단독 판별 불가.
   */
  cityCode?: string;
  /** 영문 정류장·역명(`lang=en` 응답에만, ODsay `lang=1` 정규화본 — E27). `name`은 어느 응답에서도 한국어다. */
  nameEn?: string;
  lat: number;
  lng: number;
}

/**
 * 대중교통 경로 한 구간(도보/버스/지하철). 고유명은 ODsay 한국어 원문 그대로.
 * ⚠ `lang=en` 응답에서도 `lineName`·`fromName`·`toName`은 **한국어**다(E27 §3.0 원칙 1) — 운행시간·
 * 빠른하차·실시간 추적·역명 매칭의 조인 키라 언어를 바꾸지 않는다. 영문은 `*En`(additive, en에만).
 */
export interface TransitLeg {
  mode: "walk" | "bus" | "subway";
  /** "수도권 5호선" / "341" 등 ODsay 한국어 원문 (도보는 없음) */
  lineName?: string;
  /** 영문 노선(지하철은 `subway-line-names` 표 값 — `Line 9 Express`, 버스는 영문 번호). 표 미스·ko 응답은 부재 */
  lineNameEn?: string;
  /** 승차 정류장 (도보는 없음) */
  fromName?: string;
  /** 영문 승차 정류장(`lang=en`에만) */
  fromNameEn?: string;
  /** 하차 정류장. 도보 구간에서는 "걸어서 도착할 곳"(뒤 첫 탑승 구간의 fromName) */
  toName?: string;
  /** 영문 하차 정류장·도보 행선지(`lang=en`에만) */
  toNameEn?: string;
  /**
   * 도보 구간 거리(미터). ODsay subPath.distance.
   * ⚠ 3-state: 값이 없거나 유한한 0 이상 수가 아니면 **필드 자체를 싣지 않는다**.
   *   0으로 채우면 "정보 없음"이 "0m"로 둔갑한다. 탑승 구간에는 싣지 않는다
   *   (정거장 수가 이미 표현하며 낭독에 더할 값이 아니다).
   */
  distanceMeters?: number;
  /** 정거장 수 (도보는 없음) */
  stationCount?: number;
  /** 평균 배차간격(분, ODsay subPath.intervalTime — 도보는 없음, 미제공 시 생략) */
  intervalMinutes?: number;
  /** 구간 소요시간(분) */
  minutes: number;
  /**
   * 운행 시간 판정 결과. 버스·지하철 구간은 조인 키가 없어도 반드시 갖는다
   * (조회 불가는 "unknown"). 도보만 undefined다 — 판정 대상이 아니기 때문.
   */
  serviceStatus?: "running" | "outside" | "unknown";
  /** 첫차 시각 "04:00"(판정된 경우만) */
  firstServiceTime?: string;
  /** 막차 시각 "22:30"(판정된 경우만) */
  lastServiceTime?: string;
  /** 운행시간 조인 키(ODsay busLocalBlID). 내부 식별자라 낭독에 쓰지 않는다 */
  serviceRouteId?: string;
  /** 운행시간 조회 분기용 도시 코드(ODsay busCityCode, 서울=1000) */
  serviceCityCode?: number;
  /** 지하철 방향(ODsay wayCode 1=상행·2=하행). 상·하행 첫차·막차가 달라 조인 축이다 */
  serviceWayCode?: number;
  /** 경유 정류장·역(양 끝 포함) — `includeStops=1` 옵트인 시 탑승 leg에만(B2 §7) */
  stops?: TransitLegStop[];
  /**
   * 하차역에서 계단·엘리베이터에 가장 가까운 문(서울교통공사 1~8호선, E5).
   * 판정 불가·미커버·시설 없음은 전부 **필드 부재**다("정보 없음" 문구를 만들지 않는다).
   */
  quickExit?: QuickExit;
  /**
   * 이 leg 노선의 **급행 정차역 이름 전체 집합**(노선 순서, ODsay `passStopList` 원문 — `stops[].name`과
   * 같은 표기, 정규화는 소비자 몫). 급행 운행이 있고 집합이 실호출 검증된 노선(`express-stops.ts`
   * `EXPRESS_LINES`)의 지하철 leg에만, 완행 leg에도 급행 leg에도 같은 집합이 붙는다.
   * `includeStops=1` 응답에만(A16 L1, spec `2026-09-02-express-stops-data-design.md`).
   * ⚠ 부재의 뜻은 "판정 불가"이지 "급행 없음"이 아니다 — 빈 배열은 절대 오지 않는다(빈 배열은
   *   "어느 역에도 안 선다"로 읽혀 전 열차 차단이 된다). 소비자는 부재에서 종전 `expressCheck`를 유지한다.
   * ⚠ **정차 패턴이 노선당 하나인 노선에만** 싣는다(실시간 후보의 급행 표지는 등급을 구분하지 않아 1호선
   *   급행·특급, 경의중앙 복수 패턴은 집합 하나로 결박할 수 없다 → 그런 노선은 표에 없고 필드 부재).
   */
  expressStops?: string[];
  /**
   * `expressStops`와 **같은 순서**의 ODsay `stationID` 원문(`stops[].stationId`와 같은 표기). 둘은 항상 함께 오고
   * 길이가 같다 — 소비자는 ID가 있으면 정규화 없이 ID로 판정하고(하차역 별칭 하나가 거짓 차단이 되지 않게),
   * 이름 판정은 그 폴백이다.
   */
  expressStopIds?: string[];
  /**
   * 승차·하차 출구 번호(ODsay `startExitNo`/`endExitNo`, E25). 지하철 leg·`includeStops=1`에만.
   * **값 계약**: 서버가 공백을 제거하고 `^[1-9]\d*(?:-[1-9]\d*)?$`를 통과한 것만 싣는다(`"2"`·`"10"`·`"2-1"` —
   * "3번 출구"·"1·2"·0 계열·`"null"`은 부재로 떨어진다. 실호출 관측 문법은 숫자 단독뿐, 2026-09-02).
   * **문맥 계약**: `board`는 역 밖에서 진입하는 승차(첫 탑승·버스 뒤·도보 뒤)에만, `alight`는 역 밖으로
   * 나가는 하차(마지막 탑승·버스 환승·역 밖 도보)에만 — 지하철 역내 환승 leg에는 ODsay가 값을 채워도 싣지
   * 않는다. 없는 쪽은 키 부재, 둘 다 없으면 `exit` 자체 부재.
   */
  exit?: { board?: string; alight?: string };
}

/**
 * 빠른하차 문 위치. `"6-4"`는 6번 칸 4번 문이고, 두 문 사이면 `kind: "between"`에
 * 두 문이 순서대로 담긴다 — 문 번호 자리에 `"3-2,3-3 사이"`를 그대로 넣으면
 * "엘리베이터 3-2,3-3 사이 문"이 되어 문장이 깨지므로 형태를 나눈다.
 */
export interface QuickExitDoor {
  kind: "door" | "between";
  doors: string[];
}

/**
 * 한쪽 시설만 있으면 있는 것만 싣는다 — 없는 시설을 "없음"으로 명시하지 않는다.
 *
 * **`transfer`와 `elevator|stairs`는 공존하지 않는다**(A20). 환승 leg는 ODsay 빠른환승 문
 * 하나만, 최종 하차 leg는 서교공 seed의 엘리베이터·계단만 든다 — 환승역에서 필요한 것은
 * 출구로 가는 계단이 아니라 환승 통로인데 seed에는 그 구분이 없다.
 */
export interface QuickExit {
  /** 환승 leg의 빠른환승 문(ODsay `subPath.door`). 있으면 이 문장만 낸다. */
  transfer?: QuickExitDoor;
  elevator?: QuickExitDoor;
  stairs?: QuickExitDoor;
}

/** 대안 경로의 축. 한 경로가 둘 다일 수 있어 배열이다(spec §3.3) */
export type TransitHighlight = "fastest" | "fewestTransfers";

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
    /** 영문 첫 승차·막 하차 정류장(`lang=en`에만, E27) */
    departNameEn?: string;
    arriveNameEn?: string;
  };
  legs: TransitLeg[];
  /**
   * 응답 안에서 유일한 경로 식별자(정규화 시점의 ODsay 인덱스 기반).
   * ⚠ 활성 안내 세션 추적·강제 펼침·포커스 복귀는 **배열 인덱스가 아니라 이 키로** 한다.
   *   강등 정렬·재조회로 표시 순서가 바뀌면 인덱스는 다른 경로를 가리킨다.
   */
  routeKey: string;
  /** 이 경로가 1순위보다 나은 축. 없으면 필드 부재(spec §3.3 3단계) */
  highlight?: TransitHighlight[];
  /** 축 라벨이 없는 대안의 표시 번호(1부터). 서버가 정해 3플랫폼 갈림을 막는다 */
  displayIndex?: number;
}

/** 대중교통 길찾기 결과: 추천 1개 + 대안 최대 4개(spec §2). */
export interface TransitRouteResult {
  recommended: TransitRoute;
  alternatives: TransitRoute[];
  /**
   * 절단 전 후보 경로 총수(조용한 절단 금지). ODsay는 수도권 9개·부산 16개를
   * 주는데 5개만 표시하므로 그 사실이 API에 남아야 한다. UI 표기는 하지 않는다
   * (표기 심사는 "사용자 행동을 바꾸는가"이고 총수는 바꾸지 않는다).
   */
  totalCandidates: number;
}

/**
 * 도보 경로 안내 한 단계. description은 Tmap이 완성해 주는 한국어 안내문
 * (예: "158m 이동 후 우회전")이며, 스크린 리더 낭독의 정본 텍스트로 그대로 쓴다.
 */
export interface WalkRouteStep {
  description: string;
  distanceMeters?: number;
  /**
   * 안내 지점 좌표(내부 전달용). provider가 채우고 walk-route 서비스가
   * 음향신호기 주석 판정에 쓴 뒤 **응답 전 제거**한다 — API 응답에 노출 금지.
   * coord는 단일 지점(Tmap Point), pathCoords는 스텝 폴리라인(카카오) —
   * 판정은 두 형태 모두 "후보점 목록"으로 수용한다(2026-07-29 재캘리브레이션).
   */
  coord?: Coord;
  pathCoords?: Coord[];
  /**
   * 실시간 표시 계층용 구조화 조각(서버 재작성 정규식의 분해 결과, spec 2026-08-11 §5).
   * `includeGeometry=1` 응답에만 실린다. 추출 실패는 필드 부재 — 클라이언트가
   * 한국어 문장을 재파싱해 얻지 않는다(재조합 금지 계약의 연장).
   */
  live?: { target?: string; anchor?: string };
  /**
   * 결정 지점 행동(**서버 투영**, E16 축3 spec `2026-08-23-non-ko-walk-guidance-design.md` §4.2.1).
   * `attachStepActions`가 전량 채운다: Tmap 스텝은 `turnType` 표에서, 카카오 스텝은 주석까지
   * 끝난 최종 문장을 `walkStepAction`에 태워서. 리듀서는 이 필드만 본다(`actionSource: "step"`)
   * — 클라이언트 문자열 폴백을 두면 구조화의 "의도된 행동 없음"과 미투영을 구별하지 못한다.
   * `live`와 같은 게이트로 `includeGeometry=1` 응답에만 실린다.
   */
  action?: GuideAction;
  /**
   * **이 스텝의 구간 전체가 횡단(횡단보도·지하보도)이다**(A26, 2026-08-31). 표시 계층의 횡단
   * 유닛 판정(`isCrossingStep`, 웹 ↔ Kit)이 읽는 유일한 근거 — 종전엔 클라이언트가 ko 문장의
   * "건너" 부분 문자열로 판정해 en 안내(Tmap 영어 문장)에서 횡단 유닛이 한 번도 서지 않았다.
   * `action`만으로는 부족한 이유: 카카오 스텝의 행동은 문장 분류라 "천호역 횡단보도까지
   * 100m 이동"(지명)도 crosswalk가 된다. 서버는 횡단 여부를 구조로 안다 — 카카오는 재작성이
   * 횡단 행동문을 만든 스텝(`rewriteWalkBriefing`), Tmap은 `turnType`이 횡단인 스텝
   * (`attachStepActions`). `live`·`action`과 같은 게이트로 `includeGeometry=1` 응답에만 실린다.
   */
  crossing?: true;
  /** Tmap 회전 유형 코드. en 문장 조립용 **내부 전달** — `attachStepActions`가 응답 전 제거한다. */
  turnType?: number;
  /** 첫 LineString의 도로명(ko). en 로마자 조회 키 — 응답 전 제거된다. */
  roadNameKo?: string;
}

/** 계단 회피(accessible) 요청 결과 상태 — accessible 요청 시에만 존재. */
export type StepFreeStatus = "applied" | "no_stepfree_route" | "unavailable";

/** 도보 경로 텍스트 브리핑: 지도 없이 완결되는 경로 정보의 정본(자동차 CarRouteBriefing 동형). */
export interface WalkRouteBriefing {
  distanceMeters: number;
  durationSeconds: number;
  steps: WalkRouteStep[];
  /** 계단 회피 요청 시에만 존재(옵트인 — 미요청 시 필드 자체 부재, 기존 응답 byte-호환). */
  stepFree?: StepFreeStatus;
  /**
   * 열화 상태의 안내 문장(서버 정본). `stepFree`가 존재하고 `applied`가 아닐 때만
   * 있다. `includeGeometry=1` 소비자는 유사 스텝을 받지 않으므로 이 필드가 유일한
   * 채널이다(spec 2026-08-08 §2.1).
   */
  stepFreeNotice?: string;
  /**
   * 경로 종점 → 목적지 오프셋 기하(실시간 안내 최종 접근용, spec 2026-08-08 §3.1).
   * `includeGeometry=1` ∧ 기하 조립 성공일 때만 존재한다.
   *
   * ⚠ **라우트 핸들러가 요청 원좌표로 계산해 싣는다** — provider 캐시에 넣으면
   * `roundCoord(…,4)`(±5.5m)로 뭉친 셀이 값을 공유해 다른 목적지의 방향을 말한다.
   */
  finalApproach?: FinalApproachGeometry;
  /** 경유지(`via` 요청 시에만, N4). */
  waypoint?: RouteWaypoint;
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
  /** 정류소명 로마자(E28, additive). */
  nameRoman?: string;
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
  /** `lines`의 영문(`lang=en`에만, E27 노선명 표). 하나라도 미지면 배열 전체 부재 */
  linesEn?: string[];
  /** 환승역 여부 */
  isTransfer: boolean;
  /** 운영기관명(대표, 첫 행 기준) */
  operator: string;
}

/** TAGO 지하철 노선정보(B-3) 원시 행에서 파생한 시간표 편성 하나(첫차 또는 막차). */
export interface TimetableTrain {
  /** 출발 시각("HH:mm", depTime 원문 그대로. 00~02시대 심야 편성도 이 시각 그대로 표기한다) */
  time: string;
  /** 00~02시대 심야 편성이면 true(서비스데이 정렬을 위해서만 익일로 보정하고 표시 시각은 그대로 둔다) */
  nextDay?: true;
  /** 종착역명(한글) */
  terminus: string;
  /** 종착역명(영문, seed 매칭으로 병기 가능할 때만) */
  terminusEn?: string;
}

/** 한 방향(상행 또는 하행)의 첫차·막차 쌍. */
export interface TimetableDirection {
  /** 진행 방향(TAGO upDownTypeCode 매핑) */
  direction: "up" | "down";
  first: TimetableTrain;
  last: TimetableTrain;
}

/**
 * 한 노선의 시간표 커버리지 — 업스트림이 인증 정상인데 (역·노선)별로 스케줄 0행을
 * 주는 일이 상시라(홍대입구 2호선·강남 신분당·서울역 공항, 실측 2026-08-23)
 * "없음"을 한 상태로 접을 수 없다. 지하철 도착 4-state(`arrivalStatus`)와 같은 낱말.
 * - ok: 첫차·막차 편성을 산출했다(directions가 비지 않는 유일한 값)
 * - noTrains: 읽을 수 있는 행은 있으나 탑승 가능 편성이 없다(전부 당역 종착, 참인 0)
 * - unknown: 업스트림이 준 것으로 운행 여부를 확인할 수 없다(0행·파싱 불가). "운행 없음"이 아니다
 * - unavailable: 조회 자체가 실패했다(partial도 함께 true)
 */
export type TimetableLineCoverage = "ok" | "noTrains" | "unknown" | "unavailable";

/** 한 노선의 시간표(환승역은 노선별로 여러 개가 배열에 담긴다). 매칭된 노선은 coverage와 무관하게 전부 실린다. */
export interface TimetableLine {
  /** 노선 표시명(예 "5호선","수인분당선". displayLineName로 정규화한 값) */
  lineName: string;
  /**
   * `lineName`이 TAGO 축약명에 서버가 "선"을 덧붙인 것일 때만 그 원형(예 "수인분당", A26).
   * 클라이언트는 이것으로 접미를 자기 언어로 단다(`timetable.lineSuffixed`); 부재면 `lineName`
   * 그대로(원문이 이미 "…선"). ⚠ 노선명 자체의 영문화는 E27 소관 — 여기서는 우리가 덧붙인 접미뿐.
   */
  lineCore?: string;
  /** 영문 노선명(`lang=en`에만, E27 노선명 표 — `lineCore` 접미 조립보다 우선). 표 미스면 부재 */
  lineNameEn?: string;
  coverage: TimetableLineCoverage;
  /** coverage === "ok"일 때만 비지 않는다 */
  directions: TimetableDirection[];
}

/**
 * 역 첫차·막차 시간표 전체(장소 상세 "역 정보"에서 표시하는 정본).
 * dailyType은 조회에 쓴 서비스데이 타입. 공휴일 판정 실패 시 요일 폴백은
 * partial이 아니라 dailyType 기준 라벨 명시로 정직성을 담보한다(스펙 §1-A-3).
 */
export interface StationTimetable {
  stationName: string;
  /** 조회에 사용한 서비스데이 타입(평일/토요일/일요일) */
  dailyType: "weekday" | "saturday" | "sunday";
  /** 일부 노선·방향 시간표 호출이 실패해 불완전한 결과면 true(무운행 위장 금지) */
  partial?: true;
  lines: TimetableLine[];
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
  /** 대여소명 로마자(E28, additive). */
  nameRoman?: string;
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
  /** 기관명 로마자(E28, additive). */
  nameRoman?: string;
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
  /**
   * 달빛어린이병원·소아전문응급센터 **지정** 여부. 지정 명부(getBabyListInfoInqire)는
   * true, 일반 소아청소년과 보완 소스(QD=D002)는 false.
   *
   * 커버리지 확대는 정밀도와의 거래다 — 지정 기관에는 "소아 야간진료" 품질 보증이
   * 붙어 있고 일반 소아과에는 없다(오전만 여는 곳이 같은 목록에 섞인다). UI가 이
   * 구분을 항목 텍스트로 밝혀야 하며 숨기면 안 된다.
   */
  designated?: boolean;
}

/**
 * 한 역에 도착 예정인 열차 하나 — 서울 지하철 실시간 도착(A2, OA-12764)
 * realtimeStationArrival 정규화. TAGO 미커버 도시철도의 실시간 정본.
 */
export interface SubwayArrival {
  /** 호선명(subwayId 코드 매핑, 예 "2호선","신분당선"). 미매핑 코드면 undefined. */
  line?: string;
  /** 영문 호선명(`lang=en`에만, E27 §3.4). 표 미스면 부재 */
  lineEn?: string;
  /** 상/하행 또는 내/외선(updnLine) */
  direction: string;
  /** 영문 방향(Up·Down·Inner Circle·Outer Circle, `lang=en`에만). 미지 값이면 부재 */
  directionEn?: string;
  /**
   * 행선 안내(trainLineNm) — 서울 지하철 표준상 "{종착역}행 - {주요경유}방면"
   * 완성 문구라 **종착역명을 포함**한다(예 "성수행 - 역삼방면"·"신사행 - 신논현방면").
   * 컴포넌트의 종착 정보 낭독 정본 — destination을 따로 표시하지 않아도 종착이 읽힌다.
   */
  trainLineNm: string;
  /** 영문 행선("To Seongsu via Yeoksam", `lang=en`에만 — 종착·방면 둘 다 seed 영문이 있을 때만) */
  trainLineNmEn?: string;
  /** 종착역명(bstatnNm) — trainLineNm에 이미 포함되나 데이터 정합·필터용 보조 필드. */
  destination: string;
  /** 도착 메시지(arvlMsg2 — "강남 도착","3분 후(2번째 전)" — 낭독 정본) */
  message: string;
  /**
   * 영문 도착 문장(`lang=en`에만, E27 §3.4 — `arvlCd`×문장 정확 행렬로 생성, 어긋나면 부재).
   * 괄호 현재역은 여기 담지 않는다(`currentLocationEn` 단일 채널).
   */
  messageEn?: string;
  /** 현재 위치(arvlMsg3, 예 "방배") */
  currentLocation?: string;
  /** 영문 현재 위치(`lang=en`에만 — arvlMsg3 또는 99 문장의 괄호 역명, 둘이 모순이면 부재) */
  currentLocationEn?: string;
  /** 도착 예정(초, barvlDt). 0이면 진입/도착. */
  arrivalSeconds: number;
  /** 급행 여부(btrainSttus에 "급행" 포함) — 일반 열차와 구분 */
  express: boolean;
  /**
   * 열차 번호(btrainNo 원문 문자열, B2 §4.2 잠금 복합 키의 식별자 축).
   * 위치 API trainNo와 동일 값(조사 §1.3 조인 4/4). 결측이면 undefined.
   */
  trainNo?: string;
  /** 도착 코드(arvlCd 원문: "1" 도착·"2" 출발·"99" 운행중 등). 결측이면 undefined. */
  arrivalCode?: string;
  /**
   * 데이터 수신 시각(recptnDt 원문, "yyyy-MM-dd HH:mm:ss" KST) — B2 §12.1 신선도
   * 게이트의 축. 보정용이 아니다(신분당선 동결·미래값 고장 실측). 결측이면 undefined.
   */
  receivedAt?: string;
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
 *
 * ⚠ **역은 어떤 상태에서도 목록에서 빠지지 않는다**(2026-08-02). 종전에는 실시간
 * INFO-200(데이터 없음) 역을 합성 단계에서 제외했는데, 심야에는 근접역이 전부
 * 그렇게 되어 목록이 비고 화면이 그것을 "주변에 지하철역이 없습니다"로 읽었다.
 * 근접역은 정적 seed 산출이라 시각과 무관하게 참이므로, 역의 존재(참)와 도착
 * 정보의 부재(상태)를 뭉개는 거짓말이었다. 지금은 역을 남기고 상태로 가른다.
 */
export interface NearbySubwayStation {
  /** 역명(표시·낭독용, "역" 접미사 제거) */
  stationName: string;
  /** 영문 역명(A3 seed 메타 — 외국인 보조 표기, 없을 수 있음) */
  nameEn?: string;
  /** 이 역을 지나는 노선들(seed 메타 집계 — 환승역은 여럿) */
  lines: string[];
  /** `lines`의 영문(`lang=en`에만). 하나라도 미지면 배열 전체 부재 */
  linesEn?: string[];
  /** 현재 위치로부터 Haversine 거리(m, 반올림) — 가까운 순 정렬 보존 */
  distanceMeters: number;
  /**
   * 도착조회 상태 — 넷을 절대 뭉개지 않는다(시각장애인은 화면으로 구분할 수 없다).
   * - "ok": 실시간 성공(arrivals 정본, 0건이면 정상적 "열차 없음").
   * - "unavailable": 실시간 실패(쿼터·인증·네트워크) → 장애 은폐 금지.
   * - "closed": 실시간 데이터 없음 + **그 역 시간표로 운행 시간 밖 확정**. firstTime 동반.
   * - "unknown": 실시간 데이터 없음 + 운행 여부 판정 불가(서울 실시간 미커버 역이거나
   *   시간표 조회 실패). "운행이 끝났다"고 단정하지 않는 정직한 잔여 상태다.
   */
  arrivalStatus: "ok" | "unavailable" | "closed" | "unknown";
  /** 도착 열차들(arrivalStatus==="ok"일 때만 의미 — 그 외는 []). */
  arrivals: SubwayArrival[];
  /**
   * 다음 첫차 시각 "HH:MM"(closed일 때만, 여러 노선이면 가장 이른 것).
   * 막차는 싣지 않는다 — closed는 막차가 지났다는 뜻이라 사용자가 물을 것은
   * "언제 다시 타나"뿐이다.
   */
  firstTime?: string;
}

/**
 * 조회 반경 안에 역이 하나도 없을 때 함께 실리는 **최근접 역 1곳**.
 * 반경(1km) 밖이므로 그 자리에서 탈 수 있다는 뜻이 아니라, 거리를 보고
 * "걸어갈 만한가 / 이 지역엔 도시철도가 없는가"를 사용자가 판단하기 위한 정보다.
 * 결과가 있으면 싣지 않는다(잉여).
 */
export interface NearestSubwayStation {
  stationName: string;
  nameEn?: string;
  lines: string[];
  /** `lines`의 영문(`lang=en`에만) */
  linesEn?: string[];
  distanceMeters: number;
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
  /** 측정소명 로마자(E28, additive). */
  stationNameRoman?: string;
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
  /** 이름 로마자(E28, additive). */
  nameRoman?: string;
  /** 카카오 category_name 전체 계층 */
  category: string;
  /** `category`의 영문 경로(A28, additive, 전부 등재일 때만). */
  categoryEn?: string;
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
  | "attraction"
  | "kindergarten"
  | "school"
  | "academy"
  | "parking"
  | "gasStation"
  | "culture"
  | "realEstate"
  | "lodging";

/**
 * 내 주변 둘러보기 결과 1건 — 카카오 카테고리 검색 좌표 근접.
 * 거리는 카카오 `distance`(m) 정본, 방향은 두 좌표 간 북 기준 8방위(우리가 산출).
 */
export interface SurroundingPlace {
  id: string;
  name: string;
  /** 이름 로마자(E28, additive). */
  nameRoman?: string;
  category: SurroundingCategory;
  /** 카카오 category_name 전체 계층(보조 표시) */
  categoryRaw: string;
  /** `categoryRaw`의 영문 경로(A28, additive, 전부 등재일 때만). */
  categoryEn?: string;
  distanceMeters: number;
  bearing: CompassDirection;
  lat: number;
  lng: number;
  phone?: string;
  link?: string;
  /** 도로명주소. M1이 "같은 도로인가"·"맞은편인가" 판정에 쓴다. 없으면 null. */
  roadAddress: string | null;
}

/**
 * "현재 위치" 정위 카드(where-am-i) — 좌표를 받아 네 조각을 병렬 조립한 결과.
 * 각 조각은 독립 실패(부분 실패 격리) — 전부 비면 라우트가 502.
 */
export interface WhereAmI {
  /** 도로명/지번 주소(coordToAddress). 둘 다 없으면 null. */
  address: { road?: string; jibun?: string } | null;
  /** 행정동 표시 문자열(coordToRegion, 예 "서울특별시 강동구 길동"). 없으면 null. */
  region: string | null;
  /** 가장 가까운 도시철도역 1곳(1km 내). 없으면 null. */
  nearestStation: {
    name: string;
    line?: string;
    bearing: CompassDirection;
    distanceMeters: number;
  } | null;
  /** 주변 기준점(거리순, 카페·음식점 포함). 없으면 빈 배열. */
  landmarks: SurroundingPlace[];
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

/**
 * 무장애 여행 관광지 하나 — 한국관광공사 KorWithService2 locationBasedList2 정규화.
 * 좌표기반 검색 결과 + 계산 거리. 장소 상세(편의시설)는 BarrierFreeDetail 참조.
 */
export interface BarrierFreePlace {
  contentId: string;
  name: string;
  /** 이름 로마자(E28, additive). */
  nameRoman?: string;
  /** contenttypeid 라벨(빈 문자열 허용 — Task 1 비범위) */
  category: string;
  address: string;
  lat: number;
  lng: number;
  /** 출발 좌표로부터 Haversine 거리(m, 반올림) */
  distanceMeters: number;
}

/**
 * 무장애 편의시설 항목 하나 — 화이트리스트 키·한글 라벨·서술형 값.
 * 값이 비어있지 않은 것만 포함된다(3-state 중 "값 있음" 만).
 */
export interface BarrierFreeFacility {
  /** 원본 필드 키 (예: "wheelchair") */
  key: string;
  /** 한글 라벨 (예: "휠체어 대여") */
  label: string;
  /** 서술형 텍스트(비어있지 않음) */
  value: string;
}

/**
 * 무장애 여행 편의시설 상세 — KorWithService2 detailWithTour2 정규화.
 * facilities는 값이 있는 화이트리스트 항목만 담는다(빈 배열 가능).
 */
export interface BarrierFreeDetail {
  contentId: string;
  name: string;
  /** 이름 로마자(E28, additive). */
  nameRoman?: string;
  /** 값 있는 편의시설만, 빈 배열 가능 */
  facilities: BarrierFreeFacility[];
}

/**
 * 근처 문화행사 — 서울 `culturalEventInfo`(OA-15486) 슬림 투영.
 *
 * 원본 24필드 중 "행동을 바꾸는" 것만 남긴다(설계 §2-5). 전화(`INQUIRY`)는
 * `"070-… / 02-…"`처럼 번호가 여러 개인 자유텍스트라 tel: 링크로 만들 수 없어
 * 버리고, 후속 행동은 `link`(홈페이지) 하나로 둔다.
 */
export interface CultureEvent {
  /** HMPG_ADDR의 cultcode(실측 전량 고유). 추출 실패 시 제목|장소|시작일 복합키 */
  id: string;
  title: string;
  /** CODENAME — 전시/미술·교육/체험·콘서트 등 */
  category: string;
  place: string;
  /** 제목·장소 로마자(E28, additive). 분류(`category`)는 로마자를 만들지 않는다. */
  titleRoman?: string;
  placeRoman?: string;
  /** GUNAME — 자치구 */
  district: string;
  /** DATE 원문(`2026-08-01~2026-09-20`) — 이미 완성 표기라 재조합하지 않는다 */
  dateText: string;
  /** PRO_TIME(`19:30`, `10:00~18:00`) — 자유텍스트 */
  timeText: string;
  isFree: boolean;
  /** 유료일 때의 요금 원문. 무료면 부재 */
  fee?: string;
  /** USE_TRGT — "누구나"·"24개월이상 관람가능" 등 자유텍스트(최대 53자 실측) */
  target: string;
  /** HMPG_ADDR — 상세·예매로 가는 유일한 후속 행동 */
  link?: string;
  lat: number;
  lng: number;
  /** 조회 좌표로부터의 거리(m, 코드 계산) */
  distanceMeters: number;
}
