"use client";

import { useEffect } from "react";

/**
 * 수제 서비스워커(public/sw.js) 등록 컴포넌트.
 * Serwist가 Turbopack 빌드와 비호환이라 자동 등록 대신 수동 등록 경로를 쓴다.
 * 프로덕션에서만 등록(개발 중 HMR 간섭 방지). 렌더링 출력 없음.
 */
export function SWRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[sw] 등록 실패:", err);
    });
  }, []);
  return null;
}
