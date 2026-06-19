"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { AirPollutant, AirQuality as Air } from "@/lib/types";

/**
 * 이 지역 공기질(B2) — 장소 좌표에서 가장 가까운 측정소의 실시간 공기질.
 *
 * StationMeta 동형: 진입 시 자동 fetch, 보조 정보라 실패/미커버는 조용히 null 렌더
 * (live region 불필요). 모든 장소가 좌표를 가지므로 역 여부와 무관하게 노출.
 * 등급 단어가 낭독 정본(수치는 보강), 측정 장애·부재는 "정보 없음"(grade==="unknown").
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
        const res = await fetch(
          `/api/air-quality/nearby?lat=${lat}&lng=${lng}`,
          { signal: controller.signal },
        );
        if (!active) return;
        if (!res.ok) {
          setAir(null);
          return;
        }
        const body = await res.json();
        if (active) setAir((body.air as Air) ?? null);
      } catch {
        // 보조 정보 — 실패/취소는 조용히 숨김.
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

      <p className="mt-1 text-sm opacity-80">
        {t("station", { name: air.stationName, distance: air.distanceKm })}
      </p>

      {/* 정의 리스트 대신 평문 단락 — "용어/정의" 역할·콜론 낭독 노이즈 제거. */}
      <div className="mt-1 text-sm leading-relaxed">
        <PollutantRow label={t("khai")} p={air.khai} t={t} />
        <PollutantRow label={t("pm10")} p={air.pm10} unit="㎍/㎥" t={t} />
        <PollutantRow label={t("pm25")} p={air.pm25} unit="㎍/㎥" t={t} />
      </div>

      <p className="mt-2 text-xs opacity-70">{t("asOf", { time: air.dataTime })}</p>
      <p className="mt-1 text-xs opacity-70">{t("source")}</p>
    </section>
  );
}

/**
 * 오염물질 한 줄 — "라벨 등급 (수치 단위)".
 * grade==="unknown"이면 등급은 "정보 없음"이고 수치는 표시하지 않는다
 * (해석 불가한 숫자 노출 금지 — 측정 장애 정합).
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
  const gradeText =
    p.grade === "unknown" ? t("unknown") : t(`grade.${p.grade}`);
  const showValue = p.grade !== "unknown" && p.value != null;
  return (
    <p>
      <span className="font-medium">{label}</span>{" "}
      {gradeText}
      {showValue ? ` (${p.value}${unit})` : ""}
    </p>
  );
}
