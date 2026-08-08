"use client";

import { useEffect } from "react";
import { runManualLocationJudgment } from "@/lib/effective-location";

/**
 * 판정 트리거 ①(탭이 보이는 상태로 돌아옴) + ③(탭 시작).
 * ②(force 조회)는 `awaitManualLocation`이 스스로 처리한다.
 *
 * ⚠ 트리거 ③이 없으면 웹은 탭을 닫는 순간 모듈 싱글턴이 초기화되는데
 * `localStorage`의 수동 위치는 남아, 다른 도시에서 새 탭을 열어도 옛 위치로
 * 조회하고 **영원히 교정되지 않는다**.
 */
export function useManualLocationJudgment(): void {
  useEffect(() => {
    void runManualLocationJudgment();
    const onVisible = () => {
      if (document.visibilityState === "visible") void runManualLocationJudgment();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
