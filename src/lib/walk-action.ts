/**
 * 도보 스텝 문장에서 **결정 지점의 행동**을 뽑아내는 순수 분류기(ko 전용).
 * Kit 미러: `WalkAction.swift` — 공유 fixture(walk-action-cases.json)가 동조를 강제한다.
 *
 * 쓰임은 하나다: 결정 지점 임박 큐(`route-guide.ts` 6a, 거리는 `IMMINENT_AHEAD_M`)가 무엇을 말할지 고른다.
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
export type WalkAction =
  | "left"
  | "right"
  | "back"
  | "crosswalk"
  | "underpass"
  | "keepLeft"
  | "keepRight";

/**
 * 수단 중립 별칭(K2, spec `2026-08-23-car-guidance-completion-design.md` §3.1). `keepLeft`·
 * `keepRight`는 자동차 갈래 선택이라 `walkStepAction`은 내지 않는다 — 자동차 스텝은 서버
 * `turnType` 투영(`CarAction`)으로 행동을 싣고, 리듀서는 프로파일(`actionSource`)에 따라 둘 중 **하나만**
 * 본다(car는 `action`뿐, 없으면 침묵 — 문장 폴백 없음).
 */
export type GuideAction = WalkAction;

/**
 * 결정 지점 임박 큐의 **소리**. 행동별로 가른다(N2, 2026-08-22 위원장 판정: 횡단보도·
 * 왼쪽·오른쪽·뒤로 돌기·그 외). 백그라운드·잠금에서는 문장이 나가지 않으므로 이 소리가
 * 다음 행동을 알리는 유일한 채널이다. `underpass`는 "그 외"다 — 횡단보도 비프는
 * 음향신호기의 인용이라 지하보도에 붙이면 거짓 인용이 된다.
 * Kit `imminentTone` 미러. 소리 정본은 `scripts/build-guide-tones.py`.
 */
export type ImminentTone = "ahead" | "crosswalk" | "left" | "right" | "back";

export function imminentTone(action: WalkAction): ImminentTone {
  switch (action) {
    case "crosswalk":
      return "crosswalk";
    case "left":
      return "left";
    case "right":
      return "right";
    case "back":
      return "back";
    case "underpass":
      return "ahead";
    // 갈래 선택은 회전과 같은 소리다(소리 5종을 늘리지 않는다 — N2 판정 유지).
    case "keepLeft":
      return "left";
    case "keepRight":
      return "right";
  }
}

/**
 * **회전 표지가 건널목 표지보다 먼저다.** 회전 표지는 행동을 서술하는 동사구라
 * 지명에 섞일 수 없지만, "횡단보도"는 **지명의 일부로 등장한다** — 카카오 재작성
 * 문장의 `{어디서}`·`{어디까지}` 자리가 그렇다. 건널목을 먼저 보면
 * "천호역 횡단보도에서 왼쪽으로 돌아 40m 이동"이 crosswalk로 분류돼, 좌회전 지점에서
 * "잠시 후 횡단보도를 건너세요"가 나간다.
 *
 * 반대 방향의 오분류는 성립하지 않는다: 건널목 문장은 `… 이동, 횡단보도 이용` 꼴이고
 * 그 안에 회전 동사구가 들어갈 자리가 없다. Tmap "좌측 횡단보도 진입"의 "좌측"은
 * 회전이 아니라 어느 쪽 횡단보도인지를 뜻하므로 **애초에 마커가 아니다**(이 목록에
 * "좌측"·"우측"이 없는 이유).
 */
const MARKERS: readonly (readonly [string, WalkAction])[] = [
  ["왼쪽으로 돌아", "left"],
  ["오른쪽으로 돌아", "right"],
  ["좌회전", "left"],
  ["우회전", "right"],
  // 뒤로 돌기(Tmap turnType 14 "유턴" · 카카오 재작성 문형 추정). ⚠ 실호출 55문장에서
  // 미관측 — 마커가 틀려도 결과는 침묵이고, 관측되면 fixture에 실문장을 더한다.
  ["유턴", "back"],
  ["뒤로 돌아", "back"],
  ["횡단보도", "crosswalk"],
  ["지하보도", "underpass"],
];

/** 문장이 알리는 행동. 확실한 문형이 아니면 `null`(임박 큐 미발화). */
export function walkStepAction(description: string): WalkAction | null {
  for (const [marker, action] of MARKERS) {
    if (description.includes(marker)) return action;
  }
  return null;
}
