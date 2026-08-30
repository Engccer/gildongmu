"use client";

import { KoTail, langFor } from "@/components/BilingualName";
import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AirQuality as Air, Weather } from "@/lib/types";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import { congestionLevelKey } from "@/lib/congestion-level";
import { prefersEnglish } from "@/lib/data-locale";
import { bilingualName } from "@/lib/bilingual-name";
import { AirQualityBody } from "./AirQuality";

/**
 * `/api/congestion/nearby`의 `area` 응답 모양(라우트가 명시 나열한 필드만).
 * 서비스 타입(`CongestionAreaReading`)엔 UI가 쓰지 않는 `forecast`가 있어
 * 재사용하지 않는다 — 표시 계층이 받는 것만 적는다.
 */
interface CongestionAreaInfo {
  /** 영역 코드(`POI014`). 표시에는 쓰지 않지만 응답 모양의 일부다. */
  code: string;
  name: string;
  /** 영역명 로마자(E28, additive). */
  nameRoman?: string;
  level: string;
  message: string;
  asOf: string;
}

/**
 * 이 지역 상황 — 기상청 현재 날씨 + 에어코리아 공기질 + 서울시 실시간 인구
 * 혼잡도를 단일 region으로 통합.
 *
 * 세 fetch를 직접 소유하고 전부 null이면 렌더하지 않는다(빈 heading 방지).
 * 세 fetch는 독립이라 한쪽 502가 나머지를 죽이지 않는다(graceful 조합).
 * 자동 등장 섹션이라 region 랜드마크 유지(버튼 없는 발견 경로 — CLAUDE.md 정책).
 */
export function LocalConditions({ lat, lng }: { lat: number; lng: number }) {
  const t = useTranslations("weather");
  const tCommon = useTranslations("common");
  const [weather, setWeather] = useState<Weather | null>(null);
  const [air, setAir] = useState<Air | null>(null);
  const [congestion, setCongestion] = useState<CongestionAreaInfo | null>(null);
  // 클라 bbox 선분기(props)와 서버 마커 이중 방어를 OR로 합친다 — 둘 중 하나만
  // 걸려도 커버리지 밖으로 취급(경계 오차 방어). lat/lng는 이 컴포넌트 마운트
  // 중 사실상 불변이라 재설정 없이 한 번 감지되면 유지된다.
  const [serverOutOfCoverage, setServerOutOfCoverage] = useState(false);
  const headingId = useId();
  const outOfCoverage = !isInKorea(lat, lng) || serverOutOfCoverage;

  useEffect(() => {
    if (!isInKorea(lat, lng)) return;
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
        if (isOutOfCoverageBody(body)) {
          if (active) setServerOutOfCoverage(true);
          return;
        }
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
    if (!isInKorea(lat, lng)) return;
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
        if (isOutOfCoverageBody(body)) {
          if (active) setServerOutOfCoverage(true);
          return;
        }
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

  useEffect(() => {
    if (!isInKorea(lat, lng)) return;
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/congestion/nearby?lat=${lat}&lng=${lng}`, {
          signal: controller.signal,
        });
        if (!active) return;
        if (!res.ok) {
          setCongestion(null);
          return;
        }
        const body = await res.json();
        if (isOutOfCoverageBody(body)) {
          if (active) setServerOutOfCoverage(true);
          return;
        }
        // `area: null`은 오류가 아니다 — 서울시가 혼잡도를 재는 121곳 밖이라는
        // 뜻이고(서울의 91%), 그때는 줄 자체를 만들지 않는다(부재 미설명).
        if (active) setCongestion((body.area as CongestionAreaInfo) ?? null);
      } catch {
        if (active) setCongestion(null);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [lat, lng]);

  // 커버리지 밖은 오류가 아니다 — 일반 본문 텍스트 한 줄로만 안내(별도 region 없음,
  // 이 컴포넌트는 버튼 없이 조용히 나타나는 자동 등장 카드라 기존 live 채널이 없다).
  if (outOfCoverage) {
    return <p className="mt-3 text-sm">{tCommon("outOfCoverage")}</p>;
  }

  if (!weather && !air && !congestion) return null;

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
          <p className="text-sm">{t("airLabel")}</p>
          <AirQualityBody air={air} />
        </div>
      )}

      {congestion && <CongestionBody area={congestion} />}
    </section>
  );
}

/**
 * 혼잡도 표시부 — 등급어가 낭독 정본.
 *
 * 등급어는 닫힌 집합이라 6개 로케일로 번역하되, 표에 없는 값(서울시가 단계를
 * 늘린 경우)은 원문을 그대로 낸다(정보 소실 금지). `message` 완성 문장은 API가
 * 한국어로만 주므로 한국어 로케일에서만 표시한다(§데이터 언어 분리) —
 * 비한국어 사용자에게는 등급어가 답이다.
 *
 * 인구수(`AREA_PPLTN_MIN/MAX`)는 라우트가 이미 제거했다: 시각장애 사용자가
 * 행동으로 옮길 수 없는 수치이고 등급어가 이미 답이다.
 */
function CongestionBody({ area }: { area: CongestionAreaInfo }) {
  const t = useTranslations("congestion");
  const locale = useLocale();
  const levelKey = congestionLevelKey(area.level);
  const levelText = levelKey ? t(`levels.${levelKey}`) : area.level;
  const areaName = bilingualName(locale, area.name, { roman: area.nameRoman });
  const summary = t("summary", { area: areaName.primary, level: levelText });

  return (
    <div className="mt-3 text-sm leading-relaxed">
      {/* 영역명+등급어를 단일 텍스트로(라벨 볼드 분절 포기 — 한 줄=한 객체). 비-ko는 영역명이
          로마자, 한글은 줄 끝 괄호(E28 R5). */}
      <p lang={langFor(summary)}>
        {summary}
        <KoTail secondary={areaName.secondary} />
      </p>
      {!prefersEnglish(locale) && area.message && <p>{area.message}</p>}
      <p className="mt-2 text-xs opacity-70">{t("asOf", { time: area.asOf })}</p>
      <p className="mt-1 text-xs opacity-70">{t("source")}</p>
    </div>
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
      {/* 상태어+기온을 단일 텍스트로(라벨 볼드 분절 포기). 상태어가 3-state 정본. */}
      <p>{`${conditionWord}${weather.tempC != null ? `, ${weather.tempC}°C` : ""}`}</p>
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
