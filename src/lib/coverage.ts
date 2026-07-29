/**
 * 대한민국 서비스 커버리지 정본 술어.
 * 값은 네이버 지도 URL scheme 유효 범위(구 deeplink.ts) 승격. iOS Kit Coverage.swift 미러(값 변경 시 동조).
 * 제약의 근원은 upstream API의 데이터 커버리지이며, 이 술어는 그 현실을 앞당긴 방어막이다(spec 설계 원칙 1).
 */
export const KOREA_COVERAGE_BBOX = {
  latMin: 31.43,
  latMax: 44.35,
  lngMin: 122.37,
  lngMax: 132.0,
} as const;

export function isInKorea(lat: number, lng: number): boolean {
  return (
    lat >= KOREA_COVERAGE_BBOX.latMin &&
    lat <= KOREA_COVERAGE_BBOX.latMax &&
    lng >= KOREA_COVERAGE_BBOX.lngMin &&
    lng <= KOREA_COVERAGE_BBOX.lngMax
  );
}
