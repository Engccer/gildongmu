"use client";

import { useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { bilingualName, type BilingualName } from "@/lib/bilingual-name";
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
  const format = useManualLabelFormatter();
  const manual = useManualLocation();
  if (!manual) return null;
  return format(manual.label);
}

/**
 * 표시줄용 **병기 라벨**(E28). 검증 가능/불가 판정은 `useManualLabelFormatter` 한 곳을
 * 그대로 지나므로 판정선이 갈라지지 않고, 여기서 더하는 것은 "이름의 라틴 표기를 1순위로
 * 보이고 한글은 괄호로 민다" 하나뿐이다(`labelRoman`이 없으면 종전과 byte-identical).
 *
 * 괄호(`secondary`)의 **자리**는 렌더 계층이 정한다(`KoTail` R1·R2) — 이 훅은 무엇을
 * 괄호에 넣을지만 말한다.
 */
export function useManualLocationBilingual(): { text: string; secondary: string | null } | null {
  const format = useManualLabelFormatter();
  const manual = useManualLocation();
  const locale = useLocale();
  if (!manual) return null;
  const name: BilingualName = bilingualName(locale, manual.label, { roman: manual.labelRoman });
  return { text: format(name.primary), secondary: name.secondary };
}

/**
 * **조회 시점에 기록해 둔** 원시 라벨을 지금 판정으로 감싼다(`WhereAmI` 헤딩).
 *
 * 축이 둘이고 서로 다른 시제를 갖는다: *어느 위치로 조회했나*는 기록이라 얼려야 하고
 * (`NearbyStatus.done.manualLabel`), *지금 검증 가능한가*는 현재 상태라 살아 있어야
 * 한다(며칠 전 판정이 새 세션의 라벨을 정하면 안 된다 — `CLAUDE.md` 수동 위치 절).
 * 그래서 라벨 전체를 얼리지도, 전체를 지금 상태에서 만들지도 않는다.
 *
 * ⚠ 지정이 해제된 뒤에는 검증 가능형을 쓰지 않는다 — 확인할 대상 자체가 없으므로
 * "검증 가능"이라 말할 근거가 사라진다(더 나쁜 상태가 더 안심시키는 역전 방지).
 */
export function useManualLabelFormatter(): (rawLabel: string) => string {
  const t = useTranslations("manualLocation");
  const manual = useManualLocation();
  const verdict = useManualVerdict();
  const verified = manual !== null && isManualLocationVerified(manual, verdict);
  return (rawLabel: string) =>
    verified ? t("manual", { label: rawLabel }) : t("manualUnverifiable", { label: rawLabel });
}
