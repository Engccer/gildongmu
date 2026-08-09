"use client";

import { useEffect, useState } from "react";

/**
 * `frozen`인 동안 값을 **얼린다**(직전 값 유지). 얼린 구간이 끝나면 현재 값으로
 * 돌아온다.
 *
 * ⚠ **live region을 비우는 것과 다르다.** 모달이 열릴 때 통지 문자열을 `""`로
 * 바꾸면 닫을 때 원래 문자열로 되돌아가고, `aria-live`는 내용 변경에 반응하므로
 * `X → "" → X`가 **두 번째 발화**를 만든다. 그 순간은 포커스가 트리거 버튼으로
 * 복귀하며 새 라벨이 낭독되는 시점이라(지정 결과 신호가 곧 그 라벨이다) 경쟁자가
 * 붙는다. 값을 얼려 두면 열고 닫는 동안 DOM 텍스트가 한 번도 바뀌지 않아 재발화가
 * 구조적으로 없다.
 *
 * 얼린 동안 값이 바뀌었다면 해제 시점에 그 새 값이 한 번 발화된다(정상 — 모달이
 * 자기 live region을 쓰는 동안 미뤄 둔 통지가 그때 도착한다).
 */
export function useFrozenValue<T>(value: T, frozen: boolean): T {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    // 얼지 않은 매 커밋마다 동기화한다 — 얼기 직전 커밋의 값이 곧 화면에 있던 값이라,
    // 얼린 첫 렌더가 같은 문자열을 내어 DOM이 바뀌지 않는다.
    if (!frozen) setHeld(value);
  }, [frozen, value]);
  return frozen ? held : value;
}
