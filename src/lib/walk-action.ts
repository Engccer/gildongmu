/**
 * 도보 스텝 문장에서 **결정 지점의 행동**을 뽑아내는 순수 분류기(ko 전용).
 * Kit 미러: `WalkAction.swift` — 공유 fixture(walk-action-cases.json)가 동조를 강제한다.
 *
 * 쓰임은 하나다: 결정 지점 10m 앞 임박 큐(`route-guide.ts` 6b'')가 무엇을 말할지 고른다.
 * 분류가 없으면 큐 자체가 나가지 않으므로, **미분류의 결과는 오안내가 아니라 침묵**이다.
 * 그래서 넓게 훑기보다 확실한 문형만 받는다.
 *
 * ⚠ **입력은 서버가 재작성한 문장이다**(`rewriteWalkGuidance`). 카카오 원문
 * "…왼쪽길로 107m 이동"은 클라이언트에 도달하기 전에 "…왼쪽으로 돌아 …107m 이동"으로
 * 바뀌어 있고, 재작성이 미매칭 문장을 원문 그대로 통과시키므로 Tmap 폴백 문형
 * ("좌회전")도 함께 받는다.
 *
 * ⚠ **정규식이 아니라 부분 문자열로 판정한다.** 이 판정은 Swift와 1:1로 미러해야
 * 하는데 두 언어의 정규식 엔진·이스케이프가 갈리는 반면 부분 문자열 포함은 같다.
 * 문형이 단순해 정규식이 주는 것이 없다.
 */

/**
 * 결정 지점에서 사용자가 할 행동. **낭독 문구를 고르는 키**이므로 종류를 늘리면
 * i18n 키도 함께 는다 — 문구가 달라지지 않는 구분은 만들지 않는다.
 */
export type WalkAction = "left" | "right" | "crosswalk" | "underpass";

/**
 * 건널목 표지는 회전 표지보다 **먼저** 본다. 한 문장이 둘을 함께 담으면(예:
 * 재작성이 미매칭으로 통과시킨 Tmap "좌측 횡단보도 진입") 안전 부담이 큰 쪽이
 * 이겨야 하고, 무엇보다 "좌측"은 회전이 아니라 **어느 쪽 횡단보도인지**를 뜻해
 * 회전으로 읽으면 거짓 안내가 된다.
 */
const MARKERS: readonly (readonly [string, WalkAction])[] = [
  ["횡단보도", "crosswalk"],
  ["지하보도", "underpass"],
  ["왼쪽으로 돌아", "left"],
  ["오른쪽으로 돌아", "right"],
  ["좌회전", "left"],
  ["우회전", "right"],
];

/** 문장이 알리는 행동. 확실한 문형이 아니면 `null`(임박 큐 미발화). */
export function walkStepAction(description: string): WalkAction | null {
  for (const [marker, action] of MARKERS) {
    if (description.includes(marker)) return action;
  }
  return null;
}
