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

/**
 * 서울시를 감싸는 bbox — **서울 전용 데이터 소스의 서비스 지역 판정 정본**.
 * 소비자: 따릉이(대여소)·문화행사·음향신호기 seed.
 *
 * ⚠ `scripts/build-audio-signals.mjs`가 seed 생성 필터로 같은 값을 하드코딩한다.
 * 값을 바꾸면 그 스크립트도 함께 갱신하고 seed를 재생성할 것.
 */
export const SEOUL_BBOX = {
  latMin: 37.4,
  latMax: 37.72,
  lngMin: 126.73,
  lngMax: 127.2,
} as const;

/**
 * 서울 bbox 밖으로 벗어난 거리(m). bbox 안이면 0.
 *
 * 서울 전용 서비스의 "이 좌표에서는 결과가 나올 수 없다" 판정에 쓴다. 판정선을
 * 임의로 고르지 말고 **그 도메인의 조회 반경을 그대로** 넘길 것: 반경 1km로 찾는
 * 따릉이는 bbox+1km 밖에 대여소가 존재할 수 없으므로, 판정선이 조회 반경과 같으면
 * 정의상 오판이 없다(임의 임계값에 근거를 붙일 필요 자체가 사라진다).
 *
 * ⚠ 이 판정을 **연속량인 도메인에 쓰지 말 것**. 지하철은 "역이 얼마나 먼가"가
 * 전국에 연속 분포해(2026-08-02 실측: 울산 3.5km·세종 10.0km·창원 17.3km·원주
 * 26.6km로 간격 없이 이어짐, 6~26km 구간에 국토 격자 15.7%) 어떤 임계값도
 * 자의적이다. 그런 도메인은 판정 대신 최근접 대상을 그대로 알린다.
 */
export function metersOutsideSeoul(lat: number, lng: number): number {
  const dLat =
    lat < SEOUL_BBOX.latMin
      ? SEOUL_BBOX.latMin - lat
      : lat > SEOUL_BBOX.latMax
        ? lat - SEOUL_BBOX.latMax
        : 0;
  const dLng =
    lng < SEOUL_BBOX.lngMin
      ? SEOUL_BBOX.lngMin - lng
      : lng > SEOUL_BBOX.lngMax
        ? lng - SEOUL_BBOX.lngMax
        : 0;
  if (dLat === 0 && dLng === 0) return 0;
  const latMeters = dLat * 111_000;
  const lngMeters = dLng * 111_000 * Math.cos((lat * Math.PI) / 180);
  return Math.sqrt(latMeters ** 2 + lngMeters ** 2);
}
