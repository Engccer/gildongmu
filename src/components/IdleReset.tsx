"use client";

import { useEffect } from "react";
import {
  LAST_ACTIVE_STORAGE_KEY,
  shouldIdleReset,
  shouldResetOnMount,
} from "@/lib/idle-reset";

/**
 * 유휴 복귀 초기화 — 앱을 10분 이상 쓰지 않다가 다시 활성화되면 쿼리 없는
 * 로케일 홈으로 하드 리로드해 초기 화면으로 복귀한다. 렌더링 출력 없음.
 *
 * - 기록: hidden 전환·pagehide 시 localStorage에 마지막 사용 시각 저장.
 * - 판정: visible 복귀·첫 마운트 시 저장값이 IDLE_RESET_MS보다 오래됐으면 리셋.
 *   첫 마운트는 standalone(설치형 PWA)에서 ?q= 자동 재검색이 걸릴 때만 리로드
 *   (콜드 재시작의 URL 복원 차단 — 브라우저 탭의 공유 링크 진입은 보존).
 * - localStorage 불가 환경(프라이빗 모드 등)은 조용히 무동작 — 편의 기능이지
 *   정합성 요건이 아니다.
 */
export function IdleReset({ locale }: { locale: string }) {
  useEffect(() => {
    const readLastActive = (): string | null => {
      try {
        return localStorage.getItem(LAST_ACTIVE_STORAGE_KEY);
      } catch {
        return null;
      }
    };
    const markActive = () => {
      try {
        localStorage.setItem(LAST_ACTIVE_STORAGE_KEY, String(Date.now()));
      } catch {
        // 저장 불가면 판정도 항상 false — 기능 전체가 무동작으로 수렴
      }
    };
    // replace 전에 markActive를 먼저 호출해 두므로(아래 두 경로 공통) 리로드된
    // 새 페이지는 신선한 타임스탬프를 읽는다 — 리셋 루프 없음.
    const resetToHome = () => {
      window.location.replace(`/${locale}`);
    };

    // 첫 마운트: 콜드 재시작(standalone)으로 ?q=가 복원됐고 오래됐으면 리셋
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS 홈 화면 웹앱 전용 레거시 신호(표준 매체 질의 미지원 구버전 대비)
      (window.navigator as { standalone?: boolean }).standalone === true;
    const resetAtMount = shouldResetOnMount(
      readLastActive(),
      Date.now(),
      window.location.search,
      isStandalone,
    );
    markActive();
    if (resetAtMount) {
      resetToHome();
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markActive();
        return;
      }
      // visible 복귀: 화면에 무엇이 남아 있든(상세·패널·채팅) 오래됐으면 리셋
      const stale = shouldIdleReset(readLastActive(), Date.now());
      markActive();
      if (stale) resetToHome();
    };
    const onPageHide = () => markActive();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [locale]);
  return null;
}
