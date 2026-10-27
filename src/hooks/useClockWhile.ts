"use client";

import { useEffect, useState } from "react";

/**
 * `enabled`인 동안 30초마다 갱신되는 지금(epoch ms). 옛 위치 문구("5분 전")가 열어 둔
 * 화면에서 멈춰 거짓이 되지 않게 다시 그리는 용도다(spec 2026-09-23 stale-origin §3).
 * 꺼져 있으면 타이머가 없다. 켜지는 순간의 값은 다음 틱(0ms)에 맞춘다.
 *
 * 서버 프리렌더에서는 시계를 읽지 않는다(0) — Cache Components는 프리렌더 중 `Date.now()`를
 * 빌드 오류로 막는다(D35). 서버엔 측위가 없어 옛 위치(`enabled`)가 성립하지 않으므로 그 값이
 * 화면에 쓰이지 않고, 하이드레이션 출력도 같다.
 */
export function useClockWhile(enabled: boolean): number {
  const [now, setNow] = useState(() => (typeof window === "undefined" ? 0 : Date.now()));
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [enabled]);
  return now;
}
