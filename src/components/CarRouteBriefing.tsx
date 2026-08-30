"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CarRouteBriefing as Briefing } from "@/lib/types";
import { durationToMinutes, formatDistance } from "@/lib/format";
import { StepList } from "./WalkRouteBriefing";
import { carStepItems } from "@/lib/route-step-items";
import { dataLocale } from "@/lib/data-locale";
import { awaitGeolocation } from "@/lib/geolocation";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "outOfCoverage" }
  | { kind: "done"; briefing: Briefing };

/**
 * 자동차 경로 텍스트 브리핑 — "지도 없이 완결되는 경로 정보" 실험.
 *
 * 채팅 렌더 카드(MessageBubble `car-route`) 전용 온디맨드 위젯 — 장소 상세
 * 진입점은 "여기까지 길찾기"(DirectionsView)와 중복이라 제거(2026-07-30).
 * 현재 위치(Geolocation) → /api/route/car → 턴바이턴 안내문을
 * 순서 있는 리스트로 표시한다. 스크린 리더 사용자가 출발 전에
 * 경로 전체를 미리 들을 수 있게 하는 것이 목적 — 실주행 내비는
 * 딥링크로 네이티브 앱에 위임한다 (SPEC §3).
 */
export function CarRouteBriefing({
  dest,
}: {
  dest: { lat: number; lng: number; name: string };
}) {
  const t = useTranslations("route.briefing");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inFlightRef = useRef(false);
  const focusedRef = useRef(false);

  // 펼친 브리핑을 다시 감춘다(idle 복귀) — 홈 "내 주변" 패널과 동일하게
  // 결과 블록에 닫기 경로를 준다. 닫은 뒤 포커스를 트리거 버튼으로 되돌려
  // 스크린 리더 사용자가 맥락을 잃지 않게 한다.
  const close = useCallback(() => {
    setStatus({ kind: "idle" });
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  function requestBriefing() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus({ kind: "locating" });
    // 공유 스토어에서 좌표를 얻는다 — 세션 1회 권한 획득 뒤로는 캐시 좌표를
    // 팝업 없이 재사용한다(내 주변 버튼들과 동형, navigator.geolocation 직접 호출 금지).
    void awaitGeolocation().then(async (g) => {
      try {
        if (g.status !== "ready") {
          setStatus({ kind: "error", message: t("geoError") });
          return;
        }
        if (!isInKorea(g.coords.lat, g.coords.lng)) {
          setStatus({ kind: "outOfCoverage" });
          return;
        }
        setStatus({ kind: "loading" });
        const origin = `${g.coords.lat},${g.coords.lng}`;
        // 비한국어 로케일(en/es/fr/it)은 NCP 영문 턴바이턴으로 라우팅한다 —
        // 카카오모빌리티는 ko 안내문 전용이라 외국인에겐 영문이 정본. dataLocale가
        // es/fr/it를 en으로 합쳐 라우트의 lang=en 디스패치를 태운다.
        const res = await fetch(
          `/api/route/car?origin=${origin}&dest=${dest.lat},${dest.lng}&lang=${dataLocale(locale)}`,
        );
        const body = await res.json();
        // 커버리지 마커는 200이라 res.ok보다 먼저 검사한다(NightClinicsNearby 정본 순서).
        if (isOutOfCoverageBody(body)) {
          setStatus({ kind: "outOfCoverage" });
          return;
        }
        if (!res.ok) {
          // 서버의 한국어 `error` 문자열은 낭독하지 않는다 — status·`code`로 자기 언어 문장을
          // 고른다(`useVoiceRecorder` 선례, A26). 400·404류는 재시도로 풀리지 않아 일반 오류.
          setStatus({
            kind: "error",
            message:
              res.status === 503
                ? t("notConfigured")
                : res.status === 429
                  ? t("rateLimited")
                  : body?.code === "noRoute"
                    ? t("noRoute")
                    : t("error"),
          });
          return;
        }
        setStatus({ kind: "done", briefing: body as Briefing });
      } catch {
        setStatus({ kind: "error", message: t("error") });
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  // done 진입 시 결과 헤딩으로 포커스 이동 — fetch 콜백 rAF는 React 커밋과
  // 인과관계가 없어 레이스(repo 실측) — useEffect는 커밋 이후 실행 보장.
  useEffect(() => {
    if (status.kind === "done") {
      if (!focusedRef.current) {
        focusedRef.current = true;
        headingRef.current?.focus();
      }
    } else {
      focusedRef.current = false;
    }
  }, [status.kind]);

  const busy = status.kind === "locating" || status.kind === "loading";
  const liveMessage =
    status.kind === "locating"
      ? t("locating")
      : status.kind === "loading"
        ? t("loading")
        : status.kind === "error"
          ? status.message
          : status.kind === "outOfCoverage"
            ? tCommon("outOfCoverage")
            : status.kind === "done"
              ? t("ready")
              : "";

  return (
    <div className="mt-3">
      {/* disabled 대신 aria-disabled — 진행 중에도 포커스를 잃지 않게 한다 */}
      <button
        ref={triggerRef}
        type="button"
        onClick={requestBriefing}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 aria-disabled:opacity-50 dark:text-blue-300"
      >
        {t("button")}
      </button>

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {liveMessage}
      </p>

      {status.kind === "done" && (
        <div
          className="mt-2 rounded-md border border-gray-300 p-3"
        >
          {/* 상세(h2) 하위 섹션 — StationFacilities(h3)와 레벨 통일(h2→h3) */}
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("heading", { name: dest.name })}
          </h3>
          <button
            type="button"
            onClick={close}
            className="mt-1 min-h-11 text-sm text-blue-700 underline dark:text-blue-300"
          >
            {tActions("close")}
          </button>
          <CarRouteResult briefing={status.briefing} locale={locale} t={t} />
        </div>
      )}
    </div>
  );
}


/** 경로 1개의 요약 + 턴바이턴 안내 리스트. */
export function CarRouteResult({
  briefing,
  locale,
  t,
  waypointLabel,
}: {
  briefing: Briefing;
  locale: string;
  t: ReturnType<typeof useTranslations<"route.briefing">>;
  /** 경유지 라벨(N4). `briefing.waypoint`와 함께 있을 때만 구획 문장을 그린다. */
  waypointLabel?: string | null;
}) {
  const tDir = useTranslations("directions");
  return (
    <>
      <p className="mt-1 text-sm">
        {t("summary", {
          distance: formatDistance(briefing.distanceMeters),
          minutes: durationToMinutes(briefing.durationSeconds),
          taxi: briefing.taxiFare.toLocaleString(locale),
        })}
        {briefing.tollFare > 0 && (
          <>
            {" "}
            {t("toll", {
              toll: briefing.tollFare.toLocaleString(locale),
            })}
          </>
        )}
      </p>
      <StepList
        items={carStepItems(briefing)}
        waypointIndex={briefing.waypoint?.stepIndex}
        waypointText={waypointLabel ? tDir("viaArrived", { label: waypointLabel }) : null}
        // 서버가 ko로 폴백한 안내문(A26 `guidanceLang`)은 스텝 줄마다 한국어 엔진으로 읽힌다.
        lang={briefing.guidanceLang === "ko" ? "ko" : undefined}
      />
      <p className="mt-2 text-xs opacity-70">{t("disclaimer")}</p>
    </>
  );
}
