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
}

/** 장소 검색 결과 + 메타데이터 */
export interface PlaceSearchResult {
  places: Place[];
  /** 어떤 provider가 응답했는지 — UI에서 mock 모드 안내에 사용 */
  provider: "mock" | "naver-local";
  query: string;
}

/** 길찾기 이동 수단 (네이버 지도 앱 딥링크 actionPath와 1:1 대응) */
export type RouteMode = "walk" | "public" | "car" | "bike";

/** 딥링크 생성에 필요한 출발/도착 정보 */
export interface RouteEndpoints {
  start?: { lat: number; lng: number; name: string };
  dest: { lat: number; lng: number; name: string };
}
