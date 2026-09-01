"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Place } from "@/lib/types";
import type { PlaceHoursToday } from "@/lib/place-hours";

/** 요청 상한. 캐시 금지(약관)라 상세 열람마다 실호출이 끼므로 상한 없이는 upstream이 느릴 때
 * 이 줄 하나가 화면을 세운다 — iOS `PlaceHoursService` 4초와 짝. */
const TIMEOUT_MS = 3000;

/**
 * 장소 상세 영업시간 한 줄(E24, iOS `PlaceHoursLine` 미러). 실패·부재·매칭 실패·쿼터 소진을
 * 구분하지 않고 줄 없음(침묵) — 서버가 어떤 실패도 `{hours:null}`로 접는다. 로딩 표시·통지
 * 없음(조용히 나타나는 보조 정보, 한 줄이라 region도 아니다). 전화 링크 바로 앞에 놓는다 —
 * 불확실한 시각은 전화로 확인 가능한 자리에 있을 때만 정직하다.
 * ⚠ 이 출력은 스크린 리더만 읽는다 — 채팅·CLI/MCP·안내 낭독으로 흘려보내지 말 것
 * (Google Maps 약관 §3.2.3(a)(iv), `place-hours-tts-drift.test.ts`가 파일 allowlist로 강제).
 */
export function PlaceHoursLine({ place }: { place: Place }) {
  const t = useTranslations("placeHours");
  const { lat, lng, name, roadAddress } = place;
  // 장소가 바뀌면 옛 결과가 새 장소에 붙지 않게 결과를 장소 키에 결박한다(effect 안 동기
  // setState로 비우는 대신 — react-hooks/set-state-in-effect).
  const key = `${lat},${lng},${name},${roadAddress}`;
  const [result, setResult] = useState<{ key: string; hours: PlaceHoursToday } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), name });
    if (roadAddress) params.set("roadAddress", roadAddress);
    (async () => {
      try {
        const res = await fetch(`/api/places/hours?${params}`, { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { hours?: PlaceHoursToday | null };
        if (!controller.signal.aborted && body.hours) setResult({ key, hours: body.hours });
      } catch {
        // 침묵 — 실패 종류를 가리지 않는다(위 주석).
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, lat, lng, name, roadAddress]);

  if (!result || result.key !== key) return null;
  return <p>{lineText(result.hours, t)}</p>;
}

/** 한 줄 = 한 객체. 시간표형만 쓰고 단정형("지금 영업 중")은 쓰지 않는다(위험 방향 9.1% —
 * E24 표기 규칙). "Google Maps"는 attribution 의무 표기라 번역·변형하지 않는다. */
function lineText(hours: PlaceHoursToday, t: ReturnType<typeof useTranslations>): string {
  if (hours.allDay) return t("line", { ranges: t("allDay") });
  if (hours.ranges.length === 0) return t("closed");
  const ranges = hours.ranges
    .map((r) => `${r.open}~${r.closesNextDay ? t("nextDay", { time: r.close }) : r.close}`)
    .join(", ");
  return t("line", { ranges });
}
