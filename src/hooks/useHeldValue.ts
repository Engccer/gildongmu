"use client";

import { useState } from "react";

/**
 * live region의 갱신을 구간 동안 **멈춘다**(그 순간의 값을 붙들어 둔다).
 * 모달이 자기 live region으로 화면을 점유하는 동안 밑 화면의 채널이 함께 발화하는
 * 것을 막는 용도다.
 *
 * ⚠ **비우는 것과 다르다.** 모달이 열릴 때 통지 문자열을 `""`로 바꾸면 닫을 때
 * 원래 문자열로 되돌아가고, `aria-live`는 내용 변경에 반응하므로 `X → "" → X`가
 * **두 번째 발화**를 만든다. 그 순간은 포커스가 트리거 버튼으로 복귀하며 새 라벨이
 * 낭독되는 시점이라(지정 결과 신호가 곧 그 라벨이다) 경쟁자가 붙는다. 값을 붙들어
 * 두면 열고 닫는 동안 DOM 텍스트가 한 번도 바뀌지 않아 재발화가 구조적으로 없다.
 *
 * 붙든 사이 값이 바뀌었다면 `release()` 시점에 그 새 값이 한 번 발화된다(정상 —
 * 모달이 자기 채널을 쓰는 동안 미뤄 둔 통지가 그때 도착한다).
 *
 * `hold`/`release`는 **이벤트 핸들러에서만** 부른다. effect에서 동기화하면
 * 연쇄 렌더가 되고(`set-state-in-effect`), 렌더 중 ref로 붙들면 렌더가 불순해진다
 * (`refs`) — 붙드는 시점은 사용자의 조작이라 핸들러가 제자리다.
 */
export function useHeldValue<T>(value: T): { shown: T; hold: () => void; release: () => void } {
  // null = 붙들지 않음. 값 자체가 null일 수 있으므로 래퍼 객체로 감싼다.
  const [held, setHeld] = useState<{ value: T } | null>(null);
  return {
    shown: held ? held.value : value,
    hold: () => setHeld({ value }),
    release: () => setHeld(null),
  };
}
