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
}

/** 장소 검색 요청 파라미터 */
export interface PlaceSearchParams {
  query: string;
  /** 결과 개수 (네이버 지역 검색은 최대 5) */
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
