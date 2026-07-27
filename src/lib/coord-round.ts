/**
 * 좌표 → 고정 자리수 문자열. 외부 API URL(=Next fetch 캐시 키)에 GPS 전체
 * 정밀도를 넣으면 측위마다 키가 달라져 revalidate 캐시가 헛돈다(히트율 0).
 * 4자리 약 ±5.5m(GPS 오차 미만, 경로 API용), 3자리 약 ±55m(km 간격 측정소
 * 탐색용). walk-infra.ts 타일 anchor와 같은 정신의 경량판.
 *
 * 적용 판단 기준: 캐시가 있고(revalidate), 반올림 오차가 결과를 못 바꾸는
 * 곳에만 쓴다. kakao-navi(no-store)·region-scan(시도 경계 판정, 반올림 금지 주석)
 * 에는 쓰지 말 것.
 */
export function roundCoord(value: number, digits: number): string {
  return value.toFixed(digits);
}
