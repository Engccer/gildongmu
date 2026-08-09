"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { isManualLocationVerified, type ManualLocation, type ManualVerdict } from "@/lib/manual-location";
import {
  getManualLocation,
  getManualLocationServerSnapshot,
  getManualVerdict,
  getManualVerdictServerSnapshot,
  subscribeManualLocation,
} from "@/lib/manual-location-store";

/** 수동 위치 구독 훅. 쓰기는 스토어 함수를 직접 import 한다(useGeolocation 동형). */
export function useManualLocation(): ManualLocation | null {
  return useSyncExternalStore(
    subscribeManualLocation,
    getManualLocation,
    getManualLocationServerSnapshot,
  );
}

/**
 * 마지막 판정 결과 구독. 위치와 같은 리스너를 쓰지만 **스냅샷은 분리**한다 —
 * 한 객체로 합치면 `useSyncExternalStore`가 매번 새 참조를 받아 무한 렌더가 된다.
 */
export function useManualVerdict(): ManualVerdict | null {
  return useSyncExternalStore(
    subscribeManualLocation,
    getManualVerdict,
    getManualVerdictServerSnapshot,
  );
}

/**
 * 표시용 수동 위치 라벨. 수동 위치가 없으면 `null`이고 그때 호출부가 자기 GPS
 * 문구를 쓴다.
 *
 * **표시줄·길찾기 출발지·현위치 정위가 이 훅 하나를 쓴다.** 세 곳이 각자 분기하면
 * 검증 가능/불가 판정선이 갈라지고, 갈라진 것을 화면으로 확인할 수 없다.
 * iOS는 `manualLocationLabel()`(앱 타깃)이 같은 약속을 미러한다.
 */
export function useManualLocationLabel(): string | null {
  const t = useTranslations("manualLocation");
  const manual = useManualLocation();
  const verdict = useManualVerdict();
  if (!manual) return null;
  return isManualLocationVerified(manual, verdict)
    ? t("manual", { label: manual.label })
    : t("manualUnverifiable", { label: manual.label });
}
