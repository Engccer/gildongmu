/**
 * 좌표 → 고정 자리수 문자열. 외부 API URL(=Next fetch 캐시 키)에 GPS 전체
 * 정밀도를 넣으면 측위마다 키가 달라져 revalidate 캐시가 헛돈다(히트율 0).
 * 4자리 약 ±5.5m(GPS 오차 미만, 경로 API용), 3자리 약 ±55m(km 간격 측정소
 * 탐색용). walk-infra.ts 타일 anchor와 같은 정신의 경량판.
 *
 * 적용 판단 기준: 캐시가 있고(revalidate), 반올림 오차가 결과를 못 바꾸는
 * 곳에만 쓴다. kakao-navi(no-store)·region-scan(시도 경계 판정, 반올림 금지 주석)
 * 에는 쓰지 말 것.
 *
 * ⚠ 같은 provider 안에서도 요청 종류에 따라 갈릴 수 있다: kakao-walk은
 * `accessible`(계단 회피) 요청만 반올림을 건너뛴다. 4자리 셀(약 11m) 안에 지하철
 * 출입구 두 개가 들어가고 그것이 곧 계단 유무가 갈리는 단위라, 그 분기만 위 기준을
 * 만족하지 못한다. **"이 파일을 어디에 쓰는가"가 아니라 "이 호출의 결과가 셀 안에서
 * 달라지는가"로 판단할 것.**
 */
export function roundCoord(value: number, digits: number): string {
  return value.toFixed(digits);
}
