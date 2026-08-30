"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { KoTail, langFor, useBilingualName } from "@/components/BilingualName";
import type { AirPollutant, AirQuality as Air } from "@/lib/types";

/**
 * 공기질 표시부(headless) — 측정소 줄 + KHAI/PM10/PM2.5 + 조회시각·출처.
 * region·heading 없음(상위가 소유). LocalConditions(통합 카드)와 단독
 * AirQuality(chat)가 공유해 표시 일관성을 한 곳에 둔다.
 */
export function AirQualityBody({ air }: { air: Air }) {
  const t = useTranslations("airQuality");
  const station = useBilingualName()(air.stationName, { roman: air.stationNameRoman });
  const stationLine = t("station", { name: station.primary, distance: air.distanceKm });
  return (
    <>
      {/* 측정소명 병기(E28 R5) — 비-ko는 로마자, 한글은 줄 끝 괄호. */}
      <p className="mt-1 text-sm opacity-80" lang={langFor(stationLine)}>
        {stationLine}
        <KoTail secondary={station.secondary} />
      </p>
      <div className="mt-1 text-sm leading-relaxed">
        <PollutantRow label={t("khai")} p={air.khai} t={t} />
        <PollutantRow label={t("pm10")} p={air.pm10} unit="㎍/㎥" t={t} />
        <PollutantRow label={t("pm25")} p={air.pm25} unit="㎍/㎥" t={t} />
      </div>
      <p className="mt-2 text-xs opacity-70">{t("asOf", { time: air.dataTime })}</p>
      <p className="mt-1 text-xs opacity-70">{t("source")}</p>
    </>
  );
}

/**
 * 단독 공기질 카드 — 자동 fetch + region·heading. chat get_air_quality·
 * MessageBubble 등 날씨와 묶이지 않는 단독 노출용(자동 등장 섹션이라 region 유지).
 * 홈·장소 상세의 통합 노출은 LocalConditions가 담당.
 */
export function AirQuality({ lat, lng }: { lat: number; lng: number }) {
  const t = useTranslations("airQuality");
  const [air, setAir] = useState<Air | null>(null);
  const headingId = useId();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/air-quality/nearby?lat=${lat}&lng=${lng}`, {
          signal: controller.signal,
        });
        if (!active) return;
        if (!res.ok) {
          setAir(null);
          return;
        }
        const body = await res.json();
        if (active) setAir((body.air as Air) ?? null);
      } catch {
        if (active) setAir(null);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [lat, lng]);

  if (!air) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3 rounded-md border border-border p-3"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {t("heading")}
      </h3>
      <AirQualityBody air={air} />
    </section>
  );
}

/**
 * 오염물질 한 줄 — "라벨 등급 (수치 단위)".
 * grade==="unknown"이면 등급은 "정보 없음"이고 수치는 표시하지 않는다.
 */
function PollutantRow({
  label,
  p,
  unit = "",
  t,
}: {
  label: string;
  p: AirPollutant;
  unit?: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const gradeText = p.grade === "unknown" ? t("unknown") : t(`grade.${p.grade}`);
  const showValue = p.grade !== "unknown" && p.value != null;
  // 한 줄 = 한 객체: 라벨·등급·수치를 단일 텍스트 노드로 합친다(라벨 볼드 분절
  // 포기). 등급 단어가 3-state 정본, 수치는 unknown이 아니고 값이 있을 때만.
  return (
    <p>{`${label} ${gradeText}${showValue ? ` (${p.value}${unit})` : ""}`}</p>
  );
}
