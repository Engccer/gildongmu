/**
 * 장거리 도보 상세를 접을지 판정한다(spec §4.4).
 *
 * ⚠ 판정과 표시가 같은 분 값을 써야 한다. 초 단위로 가르면 "약 30분"으로
 *   표시되는 경로가 접혀 사용자가 경계를 설명할 수 없다.
 */
export const WALK_COLLAPSE_MINUTES = 30;

export function shouldCollapseWalk(durationSeconds: number): boolean {
  return Math.round(durationSeconds / 60) > WALK_COLLAPSE_MINUTES;
}
