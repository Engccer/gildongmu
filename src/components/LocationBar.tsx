"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useManualLocation, useManualLocationLabel } from "@/hooks/useManualLocation";
import { clearManualLocation } from "@/lib/manual-location-store";
import { joinText } from "@/lib/format";

/**
 * 현재 위치 표시줄. **형제 버튼 둘**이다(중첩 인터랙티브 금지).
 *
 * 상태 텍스트는 지정 버튼의 접근 가능한 이름에 포함한다(한 줄 = 한 객체).
 * 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다 — GPS가 알아낸
 * 위치와 사용자가 지정한 위치는 다른 것이고 시각장애 사용자는 화면으로
 * 구분할 수 없다.
 */
export function LocationBar({ onPick }: { onPick: () => void }) {
  const t = useTranslations("manualLocation");
  const manual = useManualLocation();
  const manualLabel = useManualLocationLabel();
  const geo = useGeolocation();
  const pickRef = useRef<HTMLButtonElement>(null);

  const state =
    manualLabel ??
    (geo.status === "ready"
      ? t("gps")
      : geo.status === "denied" || geo.status === "unsupported"
        ? t("gpsFailed")
        : // idle(요청 전, 부모 마운트 effect가 아직 안 돎)·locating 둘 다 "확인 중" —
          // 실패는 denied·unsupported로 확정됐을 때만 말한다(idle을 실패로 오판하면
          // 페이지 첫 렌더 순간 잘못된 안내가 잠깐 뜬다).
          t("locating"));
  // 상태 + **동작**을 한 텍스트로. 상태만 이름으로 쓰면 스크린리더가 "현재 위치,
  // 버튼"으로 읽어 누르면 무엇이 되는지 단서가 0이다 — 이 기능의 유일한 진입점이고
  // 형제 버튼("지정 해제")은 동작으로 이름이 붙어 한 줄 안에서 명명이 비대칭이었다.
  // 시각 텍스트를 덮는 aria-label 대신 보이는 텍스트 자체를 합친다(한 줄 = 한 객체).
  const label = joinText(state, t("pickTitle"));

  return (
    <div className="flex items-center gap-2">
      <button
        ref={pickRef}
        type="button"
        onClick={onPick}
        className="min-h-11 flex-1 text-left underline"
      >
        {label}
      </button>
      {manual && (
        <button
          type="button"
          onClick={() => {
            clearManualLocation();
            // 자기를 없애는 버튼이라 포커스가 body로 이탈한다. 계속 존재하는
            // 지정 버튼으로 옮긴다(헌장 §5).
            pickRef.current?.focus();
          }}
          className="min-h-11 min-w-11 underline"
        >
          {t("clear")}
        </button>
      )}
    </div>
  );
}
