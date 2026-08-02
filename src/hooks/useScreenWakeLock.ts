"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * Screen Wake Lock으로 비콘 추적 중 화면이 꺼지지 않게 한다(꺼지면 watchPosition이
 * 멈추는 웹 한계 완화). 탭이 백그라운드로 가면 락이 자동 해제되므로 visibilitychange로
 * 재획득한다. 미지원·거부는 graceful no-op — 비콘 동작을 막지 않는다(화면이 꺼지면
 * 멈추는 건 고지된 한계이지 차단 사유가 아니다).
 */
export function useScreenWakeLock(): {
  acquire: () => Promise<void>;
  release: () => Promise<void>;
} {
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const activeRef = useRef(false);

  const acquire = useCallback(async () => {
    activeRef.current = true;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    try {
      lockRef.current = await navigator.wakeLock.request("screen");
    } catch {
      // 거부·정책 차단 등 — graceful.
    }
  }, []);

  const release = useCallback(async () => {
    activeRef.current = false;
    try {
      await lockRef.current?.release();
    } catch {
      // 이미 해제됨 등 — 무시.
    }
    lockRef.current = null;
  }, []);

  // 탭 재가시화 시 활성 상태면 재획득.
  useEffect(() => {
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        activeRef.current &&
        !lockRef.current
      ) {
        void acquire();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [acquire]);

  // ⚠ 안정 참조로 반환한다. acquire/release는 이미 stable(useCallback [])이지만
  // 매 렌더 새 객체 리터럴을 반환하면, 이 훅을 쓰는 useRouteGuide의 정리 effect가
  // [wakeLock] 의존이라 렌더마다 발화 → start()가 방금 등록한 watchPosition을 즉시
  // clearWatch로 지워 추적이 죽었다(감사 2026-07-04, 최초 커밋부터의 회귀).
  return useMemo(() => ({ acquire, release }), [acquire, release]);
}
