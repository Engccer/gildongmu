"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { AirQuality as Air, Weather } from "@/lib/types";
import { AirQualityBody } from "./AirQuality";

/**
 * 이 지역 날씨 — 기상청 현재 날씨 + 에어코리아 공기질을 단일 region으로 통합.
 *
 * 날씨·공기질 두 fetch를 직접 소유하고 둘 다 null이면 렌더하지 않는다(빈 heading
 * 방지). 두 fetch는 독립이라 한쪽 502가 다른 쪽을 죽이지 않는다(graceful 조합).
 * 자동 등장 섹션이라 region 랜드마크 유지(버튼 없는 발견 경로 — CLAUDE.md 정책).
 */
export function LocalConditions({ lat, lng }: { lat: number; lng: number }) {
  const t = useTranslations("weather");
  const [weather, setWeather] = useState<Weather | null>(null);
  const [air, setAir] = useState<Air | null>(null);
  const headingId = useId();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/weather/nearby?lat=${lat}&lng=${lng}`, {
          signal: controller.signal,
        });
        if (!active) return;
        if (!res.ok) {
          setWeather(null);
          return;
        }
        const body = await res.json();
        if (active) setWeather((body.weather as Weather) ?? null);
      } catch {
        if (active) setWeather(null);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [lat, lng]);

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

  if (!weather && !air) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3 rounded-md border border-border p-3"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {t("heading")}
      </h3>

      {weather && <WeatherBody weather={weather} />}

      {air && (
        <div className="mt-3">
          <p className="text-sm">
            <span className="font-medium">{t("airLabel")}</span>
          </p>
          <AirQualityBody air={air} />
        </div>
      )}
    </section>
  );
}

/**
 * 날씨 표시부 — 상태 단어가 낭독 정본. 강수형태가 "강수 없음/정보 없음"이면
 * 하늘상태를, 비/눈/소나기면 강수형태를 메인 상태어로 쓴다. 평문 `<p>`.
 */
function WeatherBody({ weather }: { weather: Weather }) {
  const t = useTranslations("weather");

  const hasPrecip =
    weather.precipitation.label !== "none" &&
    weather.precipitation.label !== "unknown";
  const conditionWord = hasPrecip
    ? t(`precipitation.${weather.precipitation.label}`)
    : weather.sky.label !== "unknown"
      ? t(`sky.${weather.sky.label}`)
      : t("unknown");

  const detailParts: string[] = [];
  if (weather.humidity != null) {
    detailParts.push(t("humidity", { humidity: weather.humidity }));
  }
  if (weather.precipProbability != null) {
    detailParts.push(t("precipProbability", { pop: weather.precipProbability }));
  }

  return (
    <div className="text-sm leading-relaxed">
      <p>
        <span className="font-medium">{conditionWord}</span>
        {weather.tempC != null ? `, ${weather.tempC}°C` : ""}
      </p>
      {weather.tempMax != null && weather.tempMin != null && (
        <p>{t("highLow", { max: weather.tempMax, min: weather.tempMin })}</p>
      )}
      {detailParts.length > 0 && <p>{detailParts.join(", ")}</p>}
      <p className="mt-2 text-xs opacity-70">
        {t("asOf", { time: weather.baseTime })}
      </p>
      <p className="mt-1 text-xs opacity-70">{t("source")}</p>
    </div>
  );
}
