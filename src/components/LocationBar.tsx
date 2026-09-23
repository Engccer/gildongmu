"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCurrentAddress } from "@/hooks/useCurrentAddress";
import { useClockWhile } from "@/hooks/useClockWhile";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useManualLocationBilingual } from "@/hooks/useManualLocation";
import { prefersEnglish } from "@/lib/data-locale";
import { staleAgeMessage, staleFixOf } from "@/lib/stale-origin";
import { bilingualName } from "@/lib/bilingual-name";
import { KoTail } from "@/components/BilingualName";

/**
 * 현재 위치 표시줄. **버튼 하나**다.
 *
 * 상태 텍스트는 지정 버튼의 접근 가능한 이름에 포함한다(한 줄 = 한 객체).
 * 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다 — GPS가 알아낸
 * 위치와 사용자가 지정한 위치는 다른 것이고 시각장애 사용자는 화면으로
 * 구분할 수 없다.
 *
 * ⚠ **형제 "지정 해제" 버튼을 되돌리지 말 것**(위원장 실사용 판정 2026-08-09).
 * GPS가 기본값이라 수동 지정은 의도적으로 고른 상태이고, 되돌리기는 지정 화면
 * 첫머리의 "현재 위치로 되돌리기"가 담당한다 — 첫 화면에 상시 노출할 빈도가
 * 아니다. 해제 경로가 이제 그 한 곳뿐이므로 `ManualLocationPicker`의 그 버튼을
 * 지우면 사용자가 수동 위치에 갇힌다(계약 테스트가 그 경로를 못 박는다).
 */
export function LocationBar({ onPick }: { onPick: () => void }) {
  const t = useTranslations("manualLocation");
  const locale = useLocale();
  const manual = useManualLocationBilingual();
  const geo = useGeolocation();
  // GPS 상태에서만 실주소를 병기한다. 이 기능의 존재 이유가 "GPS가 틀렸을 때
  // 스스로 고치는 것"인데, 주소가 없으면 시각장애 사용자는 GPS가 틀렸다는 사실
  // 자체를 알 방법이 없다(위원장 실사용 판정 2026-08-09). 수동 상태는 이미
  // 지정한 이름을 말하고 있어 주소가 잉여이므로 조회 자체를 하지 않는다
  // (표시되지 않을 라벨을 위한 역지오코딩 — DirectionsView 동형).
  // 옛 위치(spec 2026-09-23 stale-origin): 재측위가 취득 실패로 끝났고 직전 좌표가 있으면
  // 그 좌표의 주소를 옛 위치임과 시각을 밝혀 말한다. 열어 둔 동안 시각은 다시 계산한다.
  const stale = manual ? null : staleFixOf(geo);
  const now = useClockWhile(stale !== null);
  const current = useCurrentAddress(
    manual ? null : geo.status === "ready" ? geo.coords : stale,
    prefersEnglish(locale) ? "en" : "ko",
  );
  // 비-ko는 공식 영문 주소(juso) 또는 로마자를 1순위로, 한글은 버튼 끝 괄호(E28 R2).
  const address = current
    ? bilingualName(locale, current.address, { en: current.english })
    : null;

  function staleText(fixedAt: number): string {
    // staleFixOf가 측정 시각을 보장하므로 null이 아니다(시각을 모르면 옛 위치가 아니다).
    const ageMsg = staleAgeMessage(fixedAt, now)!;
    const age = t(ageMsg.key, { count: ageMsg.count });
    return address ? t("gpsStale", { address: address.primary, age }) : t("gpsStaleNoAddress", { age });
  }

  const state =
    manual?.text ??
    (geo.status === "ready"
      ? // 주소 미확보는 기존 "현재 위치"로 폴백한다 — 모르면 거짓을 말하지 않는다.
        address
        ? t("gpsNear", { address: address.primary })
        : t("gps")
      : stale
        ? staleText(stale.at)
        : geo.status === "denied" || geo.status === "unsupported"
          ? t("gpsFailed")
          : // idle(요청 전, 부모 마운트 effect가 아직 안 돎)·locating 둘 다 "확인 중" —
            // 실패는 denied·unsupported로 확정됐을 때만 말한다(idle을 실패로 오판하면
            // 페이지 첫 렌더 순간 잘못된 안내가 잠깐 뜬다).
            t("locating"));
  // 상태 + **동작**을 한 텍스트로. 상태만 이름으로 쓰면 스크린리더가 "현재 위치,
  // 버튼"으로 읽어 누르면 무엇이 되는지 단서가 0이다 — 이 기능의 유일한 진입점이다.
  // 시각 텍스트를 덮는 aria-label 대신 보이는 텍스트 자체를 합친다(한 줄 = 한 객체).
  // 접근 이름은 `joinText(state, pickTitle)`과 같다(버튼 이름 계산 — 괄호 span은 hidden).
  const pickTitle = t("pickTitle");

  return (
    <button
      type="button"
      onClick={onPick}
      className="min-h-11 w-full text-left underline"
    >
      {/* 버튼은 이름이 계산되는 요소라 괄호를 상태 문장 바로 뒤에 둬도 한 객체다(E28 R2). 접근 이름은 상태 문장, 동작 문장이다. */}
      {state}
      {/* 수동·GPS는 배타 상태다(수동이면 주소를 조회하지 않는다) — 괄호는 언제나 하나뿐. */}
      <KoTail secondary={manual ? manual.secondary : address?.secondary} />
      {`, ${pickTitle}`}
    </button>
  );
}
