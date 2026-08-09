"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** 초기 표시 수·"더 보기" 1회 공개 수 — 4중 로컬 선언의 정본(iOS Model과 동일 값). */
export const NEARBY_INITIAL_VISIBLE = 10;
export const NEARBY_REVEAL_STEP = 10;

/**
 * "더 보기" 단계 공개(스펙 §2 ④). resetKey(useNearbyFetch.doneSeq)가 바뀌면
 * 렌더 단계에서 동기 리셋한다(React 공식 derived-state 패턴) — useEffect 리셋은
 * 새 done 첫 페인트에 이전 공개 수가 비치는 글리치를 만든다.
 * 재포커스는 useLayoutEffect(페인트 전) — 마지막 배치에서 "더 보기" 버튼이 같은
 * 커밋에 사라져도 body 이탈 창이 없다(헌장 §5).
 */
export function useRevealMore<E extends HTMLElement = HTMLHeadingElement>(
  resetKey: number,
) {
  const [state, setState] = useState({ key: resetKey, count: NEARBY_INITIAL_VISIBLE });
  if (state.key !== resetKey) {
    setState({ key: resetKey, count: NEARBY_INITIAL_VISIBLE });
  }
  const itemHeadingRefs = useRef<(E | null)[]>([]);
  const pendingFocusIndex = useRef<number | null>(null);
  useLayoutEffect(() => {
    const i = pendingFocusIndex.current;
    if (i == null) return;
    pendingFocusIndex.current = null;
    itemHeadingRefs.current[i]?.focus();
  }, [state.count]);
  function reveal() {
    pendingFocusIndex.current = state.count;
    setState((s) => ({ ...s, count: s.count + NEARBY_REVEAL_STEP }));
  }
  return { visibleCount: state.count, reveal, itemHeadingRefs };
}
