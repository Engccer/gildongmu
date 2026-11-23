"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { setManualJudgmentAnnouncer } from "@/lib/effective-location";

/**
 * 수동 위치 자동 해제 통지 채널을 단일 polite live region에 연결한다.
 *
 * `setManualJudgmentAnnouncer`는 모듈 전역 슬롯 하나다 — 등록은 **뷰 전환에도
 * 언마운트되지 않는 화면(`PlaceSearch`)에서 한 번만** 한다. "내 주변" 허브처럼
 * 조건부로 마운트·언마운트되는 화면이 각자 등록하면, 그 화면을 나갈 때(cleanup이
 * `announcer = null`로 되돌리며) 채널이 영구히 비어 이후 자동 해제가 무통지가
 * 된다([[gildongmu-search-entrypoint-dry-regression]] 동형 — 복붙 진입점 하나만
 * 놓치는 회귀를 단일 정본으로 차단).
 *
 * 반환한 `resetNotice`는 새 검색·새 조회처럼 더 중요한 통지가 뒤따를 때
 * 호출부가 이 문자열을 비워 다음 렌더의 통지를 가리지 않게 한다.
 */
export function useManualLocationNotice(): [string, () => void] {
  const t = useTranslations();
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setManualJudgmentAnnouncer((verdict) => {
      if (verdict === "drop") setNotice(t("manualLocation.autoCleared"));
    });
    // 언마운트 시 슬롯을 비운다 — cleanup 이후 도착하는 늦은 판정(비동기 fetch
    // 완료 후)이 `announcer?.("drop")`을 호출해도 null이라 no-op이다(StrictMode
    // 이중 마운트·언마운트 후 유령 통지 모두 이 순서로 안전).
    return () => setManualJudgmentAnnouncer(null);
  }, [t]);

  // useCallback(빈 deps)으로 참조를 고정 — setNotice는 React가 안정성을
  // 보장하므로 이 래퍼도 매 렌더 새 함수가 되지 않는다. 호출부(runQuerySearch)의
  // useCallback 의존 배열에 넣어도 불필요한 재생성을 유발하지 않는다.
  const resetNotice = useCallback(() => setNotice(""), []);
  return [notice, resetNotice];
}
